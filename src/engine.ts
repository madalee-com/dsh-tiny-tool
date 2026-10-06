/**
 * The engine that captures the full catalog and transforms assemblies.
 * @module dsh-tiny-tool/engine
 */

import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PromptAssembly, AssembleContext } from '@deepseek-ai/dsh-system-prompt'

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
 * The dsh-tiny-tool engine: renames every base tool to `tt_<name>` internally,
 * registers proxy stubs under the original `<name>` (no `use_` prefix), and
 * transforms every system-prompt assembly so each non-exempt, non-revealed
 * tool appears as a proxy stub (truncated description, empty params `{}`).
 * Calling a proxy triggers a three-rule swap-in: forward (no original params),
 * error+swap (original has params but none passed), or forward+swap (params passed).
 */
export class TinyToolEngine {
  private readonly ctx: Context
  private readonly catalog = new Map<string, CatalogEntry>()
  private readonly exemptTools = new Set<string>()
  private readonly exemptPrefixes = new Set<string>()
  /** Base tool names whose full schema has been revealed to the model this session. */
  private readonly revealed = new Set<string>()
  /** One-time proxy disposer per renamed handle, removed after its proxy is called. */
  private readonly proxies = new Map<string, () => void>()
  /** Original name → renamed handle mapping (e.g. "gitea_branches" → "tt_gitea_branches"). */
  private readonly renamedTo = new Map<string, string>()

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
  }

  /**
   * Register a one-shot proxy stub for every non-exempt tool.
   * Proxies are registered under the original `<name>` (no `use_` prefix).
   * Internally, they point to the renamed handle (`tt_<name>`) in the catalog.
   * Calling a proxy triggers the three-rule swap-in: forward, error+swap, or forward+swap.
   */
  private registerProxies(): void {
    this.snapshotCatalog()
    const registered = this.ctx.tools.schemas()
    // Capture mutable state as locals so the proxy `execute` closure can mutate
    // the session state without relying on a bound `this`.
    const revealed = this.revealed
    const proxies = this.proxies
    const catalog = this.catalog

    for (const [originalName, renamedHandle] of this.renamedTo.entries()) {
      if (this.isExempt(originalName)) continue
      // Guard against name clashes: skip tools whose proxy already exists.
      const proxyName = originalName  // drop use_ prefix, use <name> directly
      if (registered.some(r => r.name === proxyName)) continue

      // Capture ctx reference so the closure can mark tools as revealed
      const toolCtx = this.ctx
      proxies.set(renamedHandle, toolCtx.tools.register(
        defineTool({
          name: proxyName,
          description: `Invoke to access ${originalName}.`,
          parameters: {},
          output: { schema: { type: 'string' }, render: textRender },
          async execute(args: Record<string, any> = {}) {
            const baseHandle = renamedHandle

            // Look up original tool's parameter schema from catalog
            const entry = catalog.get(baseHandle)
            if (!entry) {
              throw new Error(`Tool ${baseHandle} not found in catalog`)
            }

            const hasOriginalParams = entry.parameters &&
              Object.keys(entry.parameters as Record<string, any>).length > 0

            // Rule 1: No params on original → forward immediately, keep proxy alive
            if (!hasOriginalParams) {
              revealed.add(baseHandle)
              const disposer = proxies.get(baseHandle)
              if (disposer) { disposer(); proxies.delete(baseHandle) }
              return `Tool \`${originalName}\` is now available with full schema. Call it directly.`
            }

            // Rule 2: Original has params but none passed → error + swap
            if (Object.keys(args).length === 0) {
              throw new Error('Review tool parameters and try again.')
            }

            // Rule 3: Original has params and args were passed → forward + swap
            // Since we cannot invoke another tool from within a proxy's execute,
            // we mark it revealed and instruct the model to call the real tool.
            revealed.add(baseHandle)
            const disposer = proxies.get(baseHandle)
            if (disposer) { disposer(); proxies.delete(baseHandle) }
            return `Tool \`${originalName}\` is now available with full schema — call it directly.`
          },
        })
      ))
    }
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
   * Runs on each assemble() call to ensure tools are registered before capture.
   */
  private snapshotCatalog(): void {
    const schemas = this.ctx.tools.schemas(undefined)
    for (const schema of schemas) {
      // Skip our own proxy stubs and already-renamed internal handles.
      if (schema.name.startsWith('use_') || schema.name.startsWith('tt_')) continue

      const renamedHandle = `tt_${schema.name}`
      this.renamedTo.set(schema.name, renamedHandle)
      this.catalog.set(renamedHandle, {
        name: renamedHandle,
        description: schema.description ?? '',
        parameters: schema.parameters ?? {},
      })
    }
  }

  /**
   * Transform one settled assembly: every non-exempt, non-revealed tool is
   * shown as a proxy stub (truncated description, empty params `{}`),
   * while revealed tools and exempt tools keep their full schema. A model that
   * calls a proxy triggers the three-rule swap-in logic via the registered handler.
   * @param assembly - the settled assembly from the waterfall chain.
   * @param _scope - the calling agent scope (unused).
   * @returns the transformed assembly.
   */
  async assemble(assembly: PromptAssembly, _scope?: unknown, next?: (...args: unknown[]) => Promise<PromptAssembly>): Promise<PromptAssembly> {
    // Re-snapshot catalog fresh on each assemble to catch all registered tools,
    // including base tools registered after apply; then register proxy stubs
    // against the current catalog so they are dispatchable. Idempotent:
    // registerProxies() skips any proxy already present in ctx.tools.
    this.snapshotCatalog()
    this.registerProxies()
    if (this.catalog.size === 0) return assembly
    // Skip transformation for subagent contexts — they need full tool schemas
    let agent: any
    try {
      agent = this.ctx.agents?.currentInitiator()
    } catch {
      agent = undefined
    }
    if (agent !== undefined) {
      const depth = ((agent.options as Record<string, unknown>)?.subagentDepth ?? (agent.session?.header as unknown as Record<string, unknown>)?.delegationDepth) ?? 0
      if ((depth as number) > 0) return assembly
    }
    // Transform tools in-place: use assembly.tools as source of truth,
    // falling back to catalog for any tools not in the assembly.
    const tools = assembly.tools ?? []

    // Build stubbedTools: exclude internal handles (tt_ prefix) and legacy proxies (use_ prefix)
    const stubbedTools: ToolSchema[] = tools
      .filter(tool => !tool.name.startsWith('tt_') && !tool.name.startsWith('use_'))
      .map(tool => {
        // Look up by original name — strip tt_ if present to find the key
        const lookupKey = tool.name.startsWith('tt_') ? tool.name.slice(3) : tool.name
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
        // Revealed tools keep their full schema; everything else becomes a proxy stub (no use_ prefix).
        if (this.revealed.has(entry.name) || this.isExempt(lookupKey)) {
          return { name: lookupKey, description: entry.description, parameters: entry.parameters as ToolSchema['parameters'] }
        }
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
      if (this.revealed.has(entry.name) || this.isExempt(lookupKey)) {
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
