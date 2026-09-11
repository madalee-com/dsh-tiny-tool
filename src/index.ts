/**
 * dsh-tiny-tool: Hide all tool/MCP descriptions from the system prompt.
 *
 * When loaded, this plugin replaces every tool schema in the model-visible
 * system prompt with a minimal stub (name only). The full schemas are kept
 * in-memory and exposed through bridge tools:
 *   - tool_describe(name) — returns the full schema for one tool
 *   - tool_search(query) — keyword-searches the catalog, returns matching names
 *
 * Configurable via `exemptTools` to keep specific tools fully visible.
 *
 * @module dsh-tiny-tool
 */

import { Context } from '@deepseek-ai/cordis'
import { registerBridgeTools } from './bridge.js'
import { TinyToolEngine, type TinyToolConfig } from './engine.js'

export const name = 'dsh-tiny-tool'
export const inject = ['tools']

/**
 * Apply the plugin: snapshot the full catalog, register bridge tools, and hook
 * the system-prompt/assemble waterfall to slim every tool schema.
 * @param ctx - the plugin context.
 * @param config - plugin configuration (see TinyToolConfig).
 * @returns the engine instance.
 */
export function apply(ctx: Context, config: TinyToolConfig = {}) {
  const engine = new TinyToolEngine(ctx, config)
  registerBridgeTools(ctx, engine)
  return engine
}
