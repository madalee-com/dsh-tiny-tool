/**
 * The engine that captures the full catalog and transforms assemblies.
 * @module dsh-tiny-tool/engine
 */

import { Context } from '@deepseek-ai/cordis'
import type { PromptAssembly, AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type { ToolExecution, ToolGuard } from '@deepseek-ai/dsh-tools'

export type ToolSchema = { name: string; description: string; parameters: Record<string, unknown> }

/** Render a tool result as plain text so the model can read it directly. */
function textRender(_args: unknown, value: unknown) {
  return [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }]
}

/** One captured catalog entry — the full schema retained for re-exposure in later assemblies. */
export interface CatalogEntry {
  name: string
  description: string
  parameters: unknown
}

/**
 * Plugin configuration.
 */
export interface TinyToolConfig {
  /** Tool names to keep fully visible (do not hide descriptions). */
  exemptTools?: string[]
  /** Tool name prefixes to keep fully visible (e.g. ['mnemon_']). */
  exemptPrefixes?: string[]
  /** Retained for backward compatibility. The three-rule proxy scheme now handles
   * parameter routing at proxy-call time (forward, error, or swap-in).
   * This flag is effectively a no-op but kept to avoid breaking existing configs. */
  emptyParameters?: boolean
}

/**
 * Extract the first sentence from a description, including its terminating punctuation.
 */
function extractFirstSentence(description: string): string {
  const match = description.match(/^([^.*!?]*[.!?])/)
  return match?.[1] ?? ''
}

/**
 * The dsh-tiny-tool engine: captures the full tool catalog, transforms assemblies
 * to show proxy stubs (truncated desc, empty params), and uses a monotonic guard
 * to remove original tools from view and re-register them with full parameters
 * after the first call — so subsequent calls see the correct schema in context.
 */
export class TinyToolEngine {
  private readonly ctx: Context
  private readonly catalog = new Map<string, CatalogEntry>()
  private readonly exemptTools = new Set<string>()
  private readonly exemptPrefixes = new Set<string>()
  /** Disposers for tools we've replaced — used to restore on session teardown. */
  private readonly disposers = new Map<string, () => void>()

  constructor(ctx: Context, config: TinyToolConfig = {}) {
    this.ctx = ctx
    if (config.exemptTools) {
      for (const name of config.exemptTools) {
        this.exemptTools.add(name)
      }
    }
    if (config.exemptPrefixes) {
      for (const prefix of config.exemptPrefixes) {
        this.exemptPrefixes.add(prefix)
      }
    }
    console.error(`[dsh-tiny-tool] apply() config received: ${JSON.stringify(config)}`)
    // Register the assemble hook explicitly
    ctx.on('system-prompt/assemble', this.assemble.bind(this))
    // Register a monotonic guard that swaps out original tools with full-schema versions.
    const catalog = this.catalog
    const isExempt = this.isExempt.bind(this)
    const disposers = this.disposers
    ctx.tools.guard((exec: Readonly<ToolExecution>): string | undefined => {
      const toolName = exec.name
      if (isExempt(toolName)) return undefined

      // Look up the renamed handle in our catalog
      const lookupKey = `tt_${toolName}`
      const entry = catalog.get(lookupKey)
      if (!entry) return undefined  // not a known tool, let it through

      const hasOriginalParams = entry.parameters &&
        Object.keys(entry.parameters as Record<string, unknown>).length > 0

      // If the original has params and we haven't swapped it in yet, remove + re-add with full schema.
      // This ensures the model sees the correct tool definition before its next call.
      if (hasOriginalParams && !disposers.has(toolName)) {
        try {
          // Hide the original from the model's view
          const disposer = ctx.tools.restrict({ deny: [toolName] })
          disposers.set(toolName, disposer)
          // Register our version with full parameters and description
          ctx.tools.register({
            name: toolName,
            description: entry.description ?? '',
            parameters: entry.parameters as Record<string, unknown>,
            output: { schema: {}, render: textRender },
            execute: async () => undefined,
          })
        } catch {
          // If restrict or register throws (e.g., reserved tool), fall through silently
          // The model will still see the stub from assembly transformation.
          return undefined
        }
      }
      return undefined  // allow the call to proceed
    })
  }

  /**
   * Check if a tool name should be exempt from the proxy scheme.
   */
  private isExempt(name: string): boolean {
    if (this.exemptTools.has(name)) return true
    for (const prefix of this.exemptPrefixes) {
      if (name.startsWith(prefix)) return true
    }
    return false
  }

  /**
   * Capture the current full tool catalog from the registry.
   * Renames every base tool to `tt_<name>` internally to avoid name collisions
   * when proxies are registered under the original `<name>` (no `use_` prefix).
   */
  private snapshotCatalog(): void {
    const schemas = this.ctx.tools.schemas(undefined)
    for (const schema of schemas) {
      // Skip our own proxy stubs and already-renamed internal handles.
      if (schema.name.startsWith('use_') || schema.name.startsWith('tt_')) continue

      const renamedHandle = `tt_${schema.name}`
      this.catalog.set(renamedHandle, {
        name: renamedHandle,
        description: schema.description ?? '',
        parameters: schema.parameters ?? {},
      })
    }
  }

  /**
   * Transform one settled assembly: every non-exempt, non-replaced tool is
   * shown as a proxy stub (truncated description, empty params `{}`),
   * while replaced tools (full schema registered) and exempt tools keep
   * their complete schema.
   * @param assembly - the settled assembly from the waterfall chain.
   * @param _scope - the calling agent scope (unused).
   * @returns the transformed assembly.
   */
  async assemble(assembly: PromptAssembly, _scope?: unknown, next?: (...args: unknown[]) => Promise<PromptAssembly>): Promise<PromptAssembly> {
    // Re-snapshot catalog fresh on each assemble to catch all registered tools,
    // including base tools registered after apply.
    this.snapshotCatalog()
    if (this.catalog.size === 0) return assembly
    // Transform tools in-place: use assembly.tools as source of truth,
    // falling back to catalog for any tools not in the assembly.
    const tools = assembly.tools ?? []

    // Build stubbedTools: exclude internal handles (tt_ prefix) and legacy proxies (use_ prefix)
    const stubbedTools: ToolSchema[] = tools
      .filter(tool => !tool.name.startsWith('tt_') && !tool.name.startsWith('use_'))
      .map(tool => {
        // Look up by renamed handle — prepend tt_ for model-facing names
        const lookupKey = tool.name.startsWith('tt_') ? tool.name : `tt_${tool.name}`
        const entry = this.catalog.get(lookupKey)

        if (entry === undefined) {
          // Tool not in catalog — render as-is (unknown tool, keep full schema)
          const desc = (tool.description ?? '') as string
          return {
            name: tool.name,
            description: extractFirstSentence(desc),
            parameters: {},
          }
        }
        // Tools we've replaced (full schema registered via guard) keep their complete schema.
        if (this.disposers.has(tool.name)) {
          return { name: tool.name, description: entry.description, parameters: entry.parameters as ToolSchema['parameters'] }
        }
        // Everything else becomes a proxy stub (no use_ prefix).
        return {
          name: tool.name.startsWith('tt_') ? tool.name.slice(3) : tool.name,  // no use_ prefix
          description: extractFirstSentence(entry.description),
          parameters: {},
        }
      })

    // Also include any catalog tools not in the assembly (edge case)
    for (const entry of this.catalog.values()) {
      const lookupKey = entry.name.startsWith('tt_') ? entry.name.slice(3) : entry.name
      if (tools.some(t => t.name === lookupKey || t.name === entry.name)) continue
      // If we've replaced this tool, show full schema
      if (this.disposers.has(lookupKey)) {
        stubbedTools.push({ name: lookupKey, description: entry.description, parameters: entry.parameters as ToolSchema['parameters'] })
        continue
      }
      stubbedTools.push({
        name: lookupKey,  // no use_ prefix
        description: extractFirstSentence(entry.description),
        parameters: {},
      })
    }
    // Call next() to allow downstream listeners (e.g., mnemon) to run
    const result = next ? await next(assembly, _scope) : assembly
    return { ...result, tools: stubbedTools }
  }
}
