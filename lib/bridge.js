"use strict";
/**
 * Register the bridge tools that expose the deferred catalog on demand.
 * @module dsh-tiny-tool/bridge
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRIDGE_NAMES = void 0;
exports.registerBridgeTools = registerBridgeTools;
const dsh_tools_1 = require("@deepseek-ai/dsh-tools");
/** The bridge tool names. */
exports.BRIDGE_NAMES = ['tool_search', 'tool_describe'];
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
function registerBridgeTools(ctx, engine) {
    const deps = {
        search: (query) => engine.search(query),
        describe: (name) => engine.describe(name),
    };
    const disposers = [
        ctx.tools.register((0, dsh_tools_1.defineTool)({
            name: 'tool_search',
            description: 'Always use this to find the right tool for the job.',
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
        ctx.tools.register((0, dsh_tools_1.defineTool)({
            name: 'tool_describe',
            description: 'Always use to get tool descriptions or argument details.',
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
