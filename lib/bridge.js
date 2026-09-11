/**
 * Register the bridge tools that expose the deferred catalog on demand.
 * @module dsh-tiny-tool/bridge
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
/** The bridge tool names. */
export const BRIDGE_NAMES = ['tool_search', 'tool_describe'];
function textRender(_args, value) {
    return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }];
}
function errorMessage(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
/**
 * Register the bridge tools. Each returns a JSON string so
 * the model can parse results directly; failures return a JSON `{ error }`
 * instead of throwing.
 * @param ctx - the plugin context.
 * @param engine - engine-backed search/describe services.
 * @returns the combined disposer for all registrations.
 */
export function registerBridgeTools(ctx, engine) {
    const deps = {
        search: (query) => engine.search(query),
        describe: (name) => engine.describe(name),
    };
    const disposers = [
        ctx.tools.register(defineTool({
            name: 'tool_search',
            description: 'Search the deferred tool catalog (tools hidden to save tokens) and return matching names.',
            parameters: {
                query: { type: 'string', required: true },
            },
            output: { schema: { type: 'string' }, render: textRender },
            async execute(args, exec) {
                const { query } = args;
                try {
                    const matches = deps.search(query);
                    return JSON.stringify({ matches });
                }
                catch (error) {
                    return JSON.stringify({ error: errorMessage(error) });
                }
            },
        })),
        ctx.tools.register(defineTool({
            name: 'tool_describe',
            description: 'Load the full schema (parameters and description) of one deferred tool by name.',
            parameters: {
                name: { type: 'string', required: true },
            },
            output: { schema: { type: 'string' }, render: textRender },
            async execute(args, exec) {
                const { name } = args;
                const schema = deps.describe(name);
                if (schema === undefined)
                    return JSON.stringify({ error: `unknown tool "${name}"` });
                return JSON.stringify(schema);
            },
        })),
    ];
    return () => { for (const dispose of disposers)
        dispose(); };
}
//# sourceMappingURL=bridge.js.map