/**
 * dsh-tiny-tool client UI: Settings panel for configuring exemptions.
 * @module dsh-tiny-tool/client
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { TINY_TOOL_SETTINGS_NS, TinyToolConfigSchema } from './index.js'

/**
 * Register a bridge tool that exposes the settings namespace for UI consumption.
 * The UI can read/write this namespace to configure exemptions dynamically.
 */
export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'tiny_tool_settings',
    description: 'Get or set dsh-tiny-tool configuration (exemptTools, exemptPrefixes).',
    parameters: {
      action: { type: 'string', enum: ['get', 'set'], required: true },
      config: { type: 'json', description: 'Configuration to set (exemptTools, exemptPrefixes)' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const { action, config } = args as { action: string; config?: TinyToolConfig }
      const settings = ctx.get('settings') as any
      if (!settings) return { error: 'settings service not available' } as any

      if (action === 'get') {
        const desc = await settings.describe(TINY_TOOL_SETTINGS_NS)
        return { value: desc?.value ?? {} } as any
      }

      if (action === 'set') {
        await settings.replace(TINY_TOOL_SETTINGS_NS, config ?? {})
        return { value: { success: true } } as any
      }

      return { error: `unknown action: ${action}` } as any
    },
  }))
}

/** Configuration type for the UI. */
export interface TinyToolConfig {
  exemptTools?: string[]
  exemptPrefixes?: string[]
}

export { TinyToolConfigSchema }