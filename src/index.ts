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

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerBridgeTools } from './bridge.js'
import { TinyToolEngine, type TinyToolConfig } from './engine.js'

export const name = 'dsh-tiny-tool'
export const inject = ['tools']

/** Settings namespace for plugin configuration. */
export const TINY_TOOL_SETTINGS_NS = 'tiny-tool-config'

/** Schema for the tiny-tool configuration. */
export const TinyToolConfigSchema = z.object({
  exemptTools: z.array(z.string()),
  exemptPrefixes: z.array(z.string()),
}).loose()

/**
 * Apply the plugin: snapshot the full catalog, register bridge tools, hook
 * the system-prompt/assemble waterfall, and register settings for UI config.
 * @param ctx - the plugin context.
 * @param config - plugin configuration (see TinyToolConfig).
 * @returns the engine instance.
 */
export function apply(ctx: Context, config: TinyToolConfig = {}) {
  const engine = new TinyToolEngine(ctx, config)
  registerBridgeTools(ctx, engine)

  // DISABLED: Register settings namespace for UI configuration
  // ctx.inject(['settings'], (settingsCtx: any) => {
  //   settingsCtx.settings?.register?.(
  //     TINY_TOOL_SETTINGS_NS,
  //     TinyToolConfigSchema,
  //     { base: {} }
  //   )
  // })

  return engine
}
