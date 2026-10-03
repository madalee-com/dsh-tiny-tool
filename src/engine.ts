/**
 * The engine that captures the full catalog and transforms assemblies.
 * @module dsh-tiny-tool/engine
 */

import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BRIDGE_NAMES, textRender } from './bridge.js'
export type ToolSchema = { name: string; description: string; parameters: Record<string, unknown> }
import type { PromptAssembly, AssembleContext } from '@deepseek-ai/dsh-system-prompt'

/** One captured catalog entry — the full schema kept for on-demand describe. */
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
  /** Retained for backward compatibility. The proxy scheme now always sends
   * empty `{}` params on proxies, so this flag is effectively a no-op. */
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
 * The dsh-tiny-tool engine: snapshots the tool catalog and transforms every
 * system-prompt assembly so each non-exempt, non-revealed tool appears as a
 * `use_<name>` proxy (truncated description, empty params `{}`). Calling a
 * proxy swaps in the real base tool with its full schema for the rest of the
 * session. The full schemas remain in-memory for on-demand `tool_describe`.
 */
export class TinyToolEngine {
  private readonly ctx: Context
  private readonly catalog = new Map<string, CatalogEntry>()
  private readonly exemptTools = new Set<string>()
  private readonly exemptPrefixes = new Set<string>()
  /** Base tool names whose full schema has been revealed to the model this session. */
  private readonly revealed = new Set<string>()
  /** One-time proxy disposer per base tool name, removed after its `use_<name>` is called. */
  private readonly proxies = new Map<string, () => void>()

  constructor(ctx: Context, config: TinyToolConfig = {}) {
    this.ctx = ctx
    // Always exempt bridge tools — they need descriptions to function
    for (const name of BRIDGE_NAMES) {
      this.exemptTools.add(name)
    }
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
    // Register `use_<name>` proxy stubs for every non-exempt tool. The model
    // calls the proxy, which swaps in the real base tool with its full schema.
    this.registerProxies()
  }

  /**
   * Register a one-shot `use_<name>` proxy stub for every non-exempt tool.
   * Calling a proxy reveals the real base tool (full schema) for the rest of
   * the session and removes itself from the registry. Bridge tools and exempt
   * tools keep their full schemas untouched.
   */
  private registerProxies(): void {
    this.snapshotCatalog()
    const registered = this.ctx.tools.schemas()
    // Capture mutable state as locals so the proxy `execute` closure can mutate
    // the session state without relying on a bound `this`.
    const revealed = this.revealed
    const proxies = this.proxies
    for (const entry of this.catalog.values()) {
      if (this.isExempt(entry.name)) continue
      // Guard against name clashes: skip tools whose proxy already exists.
      const proxyName = `use_${entry.name}`
      if (registered.some(r => r.name === proxyName)) continue

      const baseName = entry.name
      const fullParameters = entry.parameters ?? {}
      proxies.set(baseName, this.ctx.tools.register(
        defineTool({
          name: proxyName,
          description: `Invoke to enable ${baseName} with its full parameters.`,
          parameters: {},
          output: { schema: { type: 'string' }, render: textRender },
          async execute() {
            // Swap in the real base tool: mark revealed (session), dispose this
            // one-shot proxy, and return the base tool's full parameter schema so
            // the model can call the real tool directly.
            revealed.add(baseName)
            const disposer = proxies.get(baseName)
            if (disposer) { disposer(); proxies.delete(baseName) }
            return JSON.stringify({
              action: 'use',
              tool: baseName,
              message: `use ${baseName} instead`,
              schema: fullParameters,
            })
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
   * Runs on each assemble() call to ensure tools are registered before capture.
   */
  private snapshotCatalog(): void {
    const schemas = this.ctx.tools.schemas(undefined)
    for (const schema of schemas) {
      this.catalog.set(schema.name, {
        name: schema.name,
        description: schema.description ?? '',
        parameters: schema.parameters ?? {},
      })
    }
  }

  /**
   * Return the full schema for one tool, or undefined if unknown.
   * Used by the `tool_describe` bridge tool.
   * @param name - the tool name.
   * @returns the full schema, or undefined.
   */
  describe(name: string): ToolSchema | undefined {
    const entry = this.catalog.get(name)
    if (entry === undefined) return undefined
    return { name: entry.name, description: entry.description, parameters: entry.parameters as ToolSchema['parameters'] }
  }

  /**
   * Keyword-search the catalog. Returns matching tool names.
   * Used by the `tool_search` bridge tool.
   * @param query - the search query (case-insensitive substring match).
   * @returns matching tool names.
   */
  search(query: string): string[] {
    const lower = query.toLowerCase()
    const matches: string[] = []
    for (const entry of this.catalog.values()) {
      if (entry.name.toLowerCase().includes(lower)
        || entry.description.toLowerCase().includes(lower)) {
        matches.push(entry.name)
      }
    }
    return matches
  }

  /**
   * Transform one settled assembly: every non-exempt, non-revealed tool is
   * shown as a `use_<name>` proxy (truncated description, empty params `{}`),
   * while revealed tools and exempt tools keep their full schema. A model that
   * calls `use_<name>` swaps in the real base tool for the rest of the
   * session. The full schemas remain in-memory for `tool_describe`.
   * @param assembly - the settled assembly from the waterfall chain.
   * @param _scope - the calling agent scope (unused).
   * @returns the transformed assembly.
   */
  async assemble(assembly: PromptAssembly, _scope?: unknown, next?: (...args: unknown[]) => Promise<PromptAssembly>): Promise<PromptAssembly> {
    // Re-snapshot catalog fresh on each assemble to catch all registered tools
    this.snapshotCatalog()
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
    // This prevents losing tools if the catalog is incomplete.
    // Also populate catalog from assembly.tools to capture tools not registered
    // through ctx.tools.register() (e.g., remote service methods like read/write).
    const tools = assembly.tools ?? []
    for (const tool of tools) {
      if (!this.catalog.has(tool.name)) {
        this.catalog.set(tool.name, {
          name: tool.name,
          description: (tool.description ?? '') as string,
          parameters: (tool.parameters ?? {}) as ToolSchema['parameters'],
        })
      }
    }
    const stubbedTools: ToolSchema[] = tools.map(tool => {
      const entry = this.catalog.get(tool.name)
      if (entry === undefined) {
        // Tool not in catalog — render a `use_<name>` proxy with truncated desc
        const desc = (tool.description ?? '') as string
        return {
          name: `use_${tool.name}`,
          description: extractFirstSentence(desc),
          parameters: {},
        }
      }
      // Revealed tools keep their full schema; everything else becomes a proxy.
      if (this.revealed.has(entry.name) || this.isExempt(entry.name)) {
        return { name: entry.name, description: entry.description, parameters: entry.parameters as ToolSchema['parameters'] }
      }
      return {
        name: `use_${entry.name}`,
        description: extractFirstSentence(entry.description),
        parameters: {},
      }
    })
    // Also include any catalog tools not in the assembly (edge case)
    for (const entry of this.catalog.values()) {
      if (tools.some(t => t.name === entry.name)) continue
      if (this.revealed.has(entry.name) || this.isExempt(entry.name)) {
        stubbedTools.push({ name: entry.name, description: entry.description, parameters: entry.parameters as ToolSchema['parameters'] })
        continue
      }
      stubbedTools.push({
        name: `use_${entry.name}`,
        description: extractFirstSentence(entry.description),
        parameters: {},
      })
    }
    // Call next() to allow downstream listeners (e.g., mnemon) to run
    const result = next ? await next(assembly, _scope) : assembly
    return { ...result, tools: stubbedTools }
  }
}
