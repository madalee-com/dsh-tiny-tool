/**
 * The engine that captures the full catalog and transforms assemblies.
 * @module dsh-tiny-tool/engine
 */

import { Context } from '@deepseek-ai/cordis'
import { BRIDGE_NAMES } from './bridge.js'
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
}

/**
 * Minify a JSON Schema by stripping descriptive metadata while preserving
 * structural typing (property names, types, required fields).
 */
function minifySchema(schema: unknown): unknown {
  if (schema === null || schema === undefined) return schema
  if (typeof schema !== 'object') return schema

  const obj = schema as Record<string, unknown>

  // Leaf node: strip descriptive fields but keep type
  if (!('properties' in obj) && !('items' in obj) && !('oneOf' in obj) && !('allOf' in obj) && !('anyOf' in obj)) {
    const minified: Record<string, unknown> = {}
    for (const key of Object.keys(obj)) {
      if (key === 'description' || key === 'default' || key === 'enum' || key === 'const' || key === 'title' || key === 'examples' || key === 'pattern' || key === 'format') continue
      minified[key] = obj[key]
    }
    return minified
  }

  // Strip descriptive keys from root before recursing
  const keepKeys = new Set(['type', 'properties', 'items', 'required', 'oneOf', 'allOf', 'anyOf', 'additionalProperties', 'pattern', 'format', 'minimum', 'maximum', 'default', 'enum', 'const', 'title', 'examples'])
  const stripped: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (!['description', 'title', 'examples', 'pattern', 'format'].includes(k)) {
      stripped[k] = v
    }
  }

  // Object with properties: recurse into each property
  if ('properties' in stripped && Array.isArray(stripped.properties)) {
    const minified = { ...stripped }
    if (Array.isArray(minified.properties)) {
      minified.properties = minified.properties.map(p => minifySchema(p))
    }
    return minified
  }

  // Object with properties map
  if ('properties' in stripped && typeof stripped.properties === 'object' && stripped.properties !== null) {
    const minified = { ...stripped }
    const props = stripped.properties as Record<string, unknown>
    const minifiedProps: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(props)) {
      minifiedProps[key] = minifySchema(value)
    }
    minified.properties = minifiedProps
    return minified
  }

  // Array items
  if ('items' in stripped) {
    const minified = { ...stripped }
    minified.items = minifySchema(stripped.items)
    return minified
  }

  // Union schemas
  for (const key of ['oneOf', 'allOf', 'anyOf'] as const) {
    if (key in stripped && Array.isArray(stripped[key])) {
      const minified = { ...stripped }
      minified[key] = stripped[key].map(s => minifySchema(s))
      return minified
    }
  }

  return schema
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
 * system-prompt assembly to hide all tool descriptions behind minimum versions,
 * except for any explicitly exempted tools.
 */
export class TinyToolEngine {
  private readonly ctx: Context
  private readonly catalog = new Map<string, CatalogEntry>()
  private readonly exemptTools = new Set<string>()
  private readonly exemptPrefixes = new Set<string>()

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
    // Register the assemble hook explicitly
    ctx.on('system-prompt/assemble', this.assemble.bind(this))
    // Register the pre-step hook to inject tool_describe instruction as context
    ctx.on('agent/pre-step', this.preStep.bind(this), { prepend: true })
  }

  /**
   * Check if a tool name should be exempt from minification.
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
   * Transform one settled assembly: replace every tool schema with a minimum
   * version (preserves property names and types, strips descriptions), except
   * for any explicitly exempted tools which keep their full schema. The full
   * schemas remain in-memory for `tool_describe`.
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
    const tools = assembly.tools ?? []
    const stubbedTools: ToolSchema[] = tools.map(tool => {
      const entry = this.catalog.get(tool.name)
      if (entry === undefined) {
        // Tool not in catalog — still truncate description
        const desc = (tool.description ?? '') as string
        return {
          name: tool.name,
          description: extractFirstSentence(desc),
          parameters: minifySchema(tool.parameters) as ToolSchema['parameters'],
        }
      }
      if (this.isExempt(entry.name)) {
        return { name: entry.name, description: entry.description, parameters: entry.parameters as ToolSchema['parameters'] }
      }
      return {
        name: entry.name,
        description: extractFirstSentence(entry.description),
        parameters: minifySchema(entry.parameters) as ToolSchema['parameters'],
      }
    })
    // Also include any catalog tools not in the assembly (edge case)
    for (const entry of this.catalog.values()) {
      if (!tools.some(t => t.name === entry.name)) {
        stubbedTools.push({
          name: entry.name,
          description: this.isExempt(entry.name) ? entry.description : extractFirstSentence(entry.description),
          parameters: minifySchema(entry.parameters) as ToolSchema['parameters'],
        })
      }
    }
    // Call next() to allow downstream listeners (e.g., mnemon) to run
    const result = next ? await next(assembly, _scope) : assembly
    return { ...result, tools: stubbedTools }
  }

  /**
   * Inject the tool_describe instruction as a context message after the system prompt
   * and after every compaction, similar to how mnemon injects its guidance.
   */
  async preStep(payload: any, next: (...args: unknown[]) => Promise<any>): Promise<any> {
    const decision = await next()
    // Only inject on step 1 (first turn of a session) and after compaction
    if (payload?.step !== 1) return decision
    // Check if we've already injected this instruction
    const alreadyInjected = decision?.messages?.some((msg: any) => {
      const source = msg?.source
      return source?.kind === 'plugin' && source?.plugin === 'dsh-tiny-tool'
    })
    if (alreadyInjected) return decision
    if (!decision?.messages?.length) return decision
    // Inject the instruction as a user message with plugin source
    const instruction = 'use tool_describe before using other tools and after every tool failure, this is NON-NEGOTIABLE'
    const pluginMessage = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content: [{ type: 'text' as const, text: instruction }],
      source: {
        kind: 'plugin' as const,
        plugin: 'dsh-tiny-tool',
        form: 'instructions' as const,
      },
    }
    return {
      kind: 'enter' as const,
      messages: [...decision.messages, pluginMessage],
    }
  }
}
