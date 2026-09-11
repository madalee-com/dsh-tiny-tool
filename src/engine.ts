/**
 * The engine that captures the full catalog and transforms assemblies.
 * @module dsh-tiny-tool/engine
 */

import { Context } from '@deepseek-ai/cordis'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
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

  // Object with properties: recurse into each property
  if ('properties' in obj && Array.isArray(obj.properties)) {
    const minified: Record<string, unknown> = { ...obj }
    if (Array.isArray(minified.properties)) {
      minified.properties = minified.properties.map(p => minifySchema(p))
    }
    return minified
  }

  // Object with properties map
  if ('properties' in obj && typeof obj.properties === 'object' && obj.properties !== null) {
    const minified: Record<string, unknown> = { ...obj }
    const props = obj.properties as Record<string, unknown>
    const minifiedProps: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(props)) {
      minifiedProps[key] = minifySchema(value)
    }
    minified.properties = minifiedProps
    return minified
  }

  // Array items
  if ('items' in obj) {
    const minified: Record<string, unknown> = { ...obj }
    minified.items = minifySchema(obj.items)
    return minified
  }

  // Union schemas
  for (const key of ['oneOf', 'allOf', 'anyOf'] as const) {
    if (key in obj && Array.isArray(obj[key])) {
      const minified: Record<string, unknown> = { ...obj }
      minified[key] = obj[key].map(s => minifySchema(s))
      return minified
    }
  }

  return schema
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

  constructor(ctx: Context, config: TinyToolConfig = {}) {
    this.ctx = ctx
    if (config.exemptTools) {
      for (const name of config.exemptTools) {
        this.exemptTools.add(name)
      }
    }
    // Register the assemble hook explicitly
    ctx.on('system-prompt/assemble', this.assemble.bind(this))
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
  async assemble(assembly: PromptAssembly, _scope?: unknown): Promise<PromptAssembly> {
    // Re-snapshot catalog fresh on each assemble to catch all registered tools
    this.snapshotCatalog()
    if (this.catalog.size === 0) return assembly
    // Skip transformation for subagent contexts — they need full tool schemas
    const agent = this.ctx.agents?.currentInitiator()
    if (agent?.session.header.origin === 'subagent') return assembly
    // Transform tools in-place: use assembly.tools as source of truth,
    // falling back to catalog for any tools not in the assembly.
    // This prevents losing tools if the catalog is incomplete.
    const tools = assembly.tools ?? []
    const stubbedTools: ToolSchema[] = tools.map(tool => {
      const entry = this.catalog.get(tool.name)
      if (entry === undefined) {
        // Tool not in catalog — keep as-is to avoid losing it
        return tool
      }
      if (this.exemptTools.has(entry.name)) {
        return { name: entry.name, description: entry.description, parameters: entry.parameters as ToolSchema['parameters'] }
      }
      return {
        name: entry.name,
        description: '',
        parameters: minifySchema(entry.parameters) as ToolSchema['parameters'],
      }
    })
    // Also include any catalog tools not in the assembly (edge case)
    for (const entry of this.catalog.values()) {
      if (!tools.some(t => t.name === entry.name)) {
        stubbedTools.push({
          name: entry.name,
          description: this.exemptTools.has(entry.name) ? entry.description : '',
          parameters: minifySchema(entry.parameters) as ToolSchema['parameters'],
        })
      }
    }
    return { ...assembly, tools: stubbedTools }
  }
}
