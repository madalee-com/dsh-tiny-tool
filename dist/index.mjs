/**
 * dsh-tiny-tool: Hide all tool/MCP descriptions from the system prompt.
 *
 * When loaded, this plugin replaces every tool schema in the model-visible
 * system prompt with a minimal stub (name only). The full schemas are kept
 * in-memory and exposed through bridge tools:
 *   - tool_describe(name) — returns the full schema for one tool
 *   - tool_search(query) — keyword-searches the catalog, returns matching names
 *
 * Configurable via settings namespace `tiny-tool-config`.
 *
 * @module dsh-tiny-tool
 */

export const name = 'dsh-tiny-tool'
export const inject = ['tools']

/** Settings namespace for plugin configuration. */
export const TINY_TOOL_SETTINGS_NS = 'tiny-tool-config'

/** Schema for the tiny-tool configuration. */
export const TinyToolConfigSchema = {
  exemptTools: [],
  exemptPrefixes: []
}

/**
 * Apply the plugin: snapshot the full catalog, register bridge tools, hook
 * the system-prompt/assemble waterfall, and register settings for UI config.
 * @param ctx - the plugin context.
 * @param config - plugin configuration (see TinyToolConfig).
 * @returns the engine instance.
 */
export function apply(ctx, config = {}) {
  const engine = new TinyToolEngine(ctx, config)
  // DISABLED: registerBridgeTools(ctx, engine)
  // DISABLED: Register settings namespace for UI configuration
  return engine
}

class TinyToolEngine {
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.exemptTools = new Set()
    this.exemptPrefixes = new Set()
    // Always exempt bridge tools — they need descriptions to function
    this.exemptTools.add('tool_search')
    this.exemptTools.add('tool_describe')
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
  }
}
