/**
 * Register the bridge tools that expose the deferred catalog on demand.
 * @module dsh-tiny-tool/bridge
 */

import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { TinyToolEngine } from './engine.js'

/** The bridge tool names. */
export const BRIDGE_NAMES = ['tool_search', 'tool_describe'] as const

type BridgeDeps = {
  search: (query: string) => string[]
  describe: (name: string) => import('@deepseek-ai/dsh-llm').ToolSchema | undefined
}

function textRender(_args: unknown, value: unknown) {
  return [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }]
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Register the bridge tools. Each returns a JSON string so
 * the model can parse results directly; failures return a JSON `{ error }`
 * instead of throwing.
 * @param ctx - the plugin context.
 * @param engine - engine-backed search/describe services.
 * @returns the combined disposer for all registrations.
 */
export function registerBridgeTools(ctx: Context, engine: TinyToolEngine) {
  const deps: BridgeDeps = {
    search: (query: string) => engine.search(query),
    describe: (name: string) => engine.describe(name),
  }

  const disposers = [
    ctx.tools.register(defineTool({
      name: 'tool_search',
      description: 'Search the deferred tool catalog (tools hidden to save tokens) and return matching names.',
      parameters: {
        query: { type: 'string', required: true },
      },
      output: { schema: { type: 'string' }, render: textRender },
      async execute(args, exec) {
        const { query } = args as { query: string }
        try {
          const matches = deps.search(query)
          return JSON.stringify({ matches })
        } catch (error) {
          return JSON.stringify({ error: errorMessage(error) })
        }
      },
    })),
    ctx.tools.register(defineTool({
      name: 'tool_describe',
      description: 'Always use to get tool descriptions or argument details.',
      parameters: {
        name: { type: 'string', required: true },
      },
      output: { schema: { type: 'string' }, render: textRender },
      async execute(args, exec) {
        const { name } = args as { name: string }
        const schema = deps.describe(name)
        if (schema === undefined)
          return JSON.stringify({ error: `unknown tool "${name}"` })
        return JSON.stringify(schema)
      },
    })),
  ]

  return () => { for (const dispose of disposers) dispose() }
}
