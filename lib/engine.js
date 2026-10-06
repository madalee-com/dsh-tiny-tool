/**
 * The engine that captures the full catalog and transforms assemblies.
 * @module dsh-tiny-tool/engine
 */
/** Render a tool result as plain text so the model can read it directly. */
function textRender(_args, value) {
    return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }];
}
/** Extract the first sentence from a description, including its terminating punctuation. */
function extractFirstSentence(description) {
    const match = description.match(/^([^.*!?]*[.!?])/);
    return match?.[1] ?? '';
}
/**
 * The dsh-tiny-tool engine: captures the full tool catalog, presents every
 * non-exempt tool as a stub (truncated description, empty params `{}`), and on
 * the first call swaps the stub for the tool's real full schema — removing our
 * proxy and re-adding the original so subsequent assemblies show correct params.
 */
export class TinyToolEngine {
    ctx;
    catalog = new Map();
    exemptTools = new Set();
    exemptPrefixes = new Set();
    /** Captured original full-schema definitions, keyed by model-facing name. */
    originals = new Map();
    /** One-shot empty-proxy disposer per stubbed tool, removed once swapped in. */
    proxies = new Map();
    /** Model-facing names whose real schema has been swapped into this session. */
    revealed = new Set();
    constructor(ctx, config = {}) {
        this.ctx = ctx;
        if (config.exemptTools) {
            for (const name of config.exemptTools) {
                this.exemptTools.add(name);
            }
        }
        if (config.exemptPrefixes) {
            for (const prefix of config.exemptPrefixes) {
                this.exemptPrefixes.add(prefix);
            }
        }
        console.error(`[dsh-tiny-tool] apply() config received: ${JSON.stringify(config)}`);
        // Capture the full catalog ONCE (pristine, before any stub is registered),
        // then register one empty proxy stub per non-exempt, parametered tool.
        this.registerProxies();
        // Register the assemble hook explicitly.
        ctx.on('system-prompt/assemble', this.assemble.bind(this));
        // Monotonic guard: on the first call to a stubbed tool, remove the empty
        // proxy and re-add the original full-schema definition so the model sees
        // the correct parameters in its next assembly.
        const catalog = this.catalog;
        const originals = this.originals;
        const proxies = this.proxies;
        const revealed = this.revealed;
        const isExempt = this.isExempt.bind(this);
        ctx.tools.guard((exec) => {
            const toolName = exec.name;
            if (isExempt(toolName))
                return undefined; // exempt tools are never stubbed or swapped
            // Only act on tools we have actually stubbed; let unknowns pass through.
            if (!proxies.has(toolName))
                return undefined;
            // Swap in exactly once per tool this session.
            if (revealed.has(toolName))
                return undefined;
            revealed.add(toolName);
            const entry = catalog.get(`tt_${toolName}`);
            const hasOriginalParams = !!entry && typeof entry === 'object' &&
                Object.keys(entry.parameters).length > 0;
            // Remove our empty proxy stub, then re-add the original full-schema tool.
            // This is the "remove one tool, add another" action that refreshes the
            // schema seen in context for the model's next call.
            try {
                const proxyDisposer = proxies.get(toolName);
                if (proxyDisposer)
                    proxyDisposer();
                const originalDef = originals.get(toolName);
                if (originalDef) {
                    ctx.tools.register(originalDef);
                }
            }
            catch (err) {
                console.error(`[dsh-tiny-tool] failed to swap in \`${toolName}\`: ${String(err)}`);
            }
            // Rule 2: the tool requires parameters but none were passed — deny with a
            // hint so the model reviews the newly-revealed schema and calls again.
            if (hasOriginalParams) {
                const args = exec.arguments;
                const passedArgs = !!args && Object.keys(args).length > 0;
                if (!passedArgs) {
                    return `Tool \`${toolName}\` requires parameters. Review its schema and call again.`;
                }
            }
            // Otherwise allow the call; the next assembly now shows full params.
            return undefined;
        });
    }
    /** Check if a tool name should be exempt from the proxy scheme. */
    isExempt(name) {
        if (this.exemptTools.has(name))
            return true;
        for (const prefix of this.exemptPrefixes) {
            if (name.startsWith(prefix))
                return true;
        }
        return false;
    }
    /**
     * Capture the full tool catalog from the registry. Runs once at construction,
     * before any proxy stub is registered, so entries keep their real parameters.
     */
    snapshotCatalog() {
        const schemas = this.ctx.tools.schemas(undefined);
        for (const schema of schemas) {
            // Skip proxy stubs and already-renamed internal handles.
            if (schema.name.startsWith('use_') || schema.name.startsWith('tt_'))
                continue;
            const renamedHandle = `tt_${schema.name}`;
            this.catalog.set(renamedHandle, {
                name: renamedHandle,
                description: schema.description ?? '',
                parameters: schema.parameters ?? {},
            });
        }
    }
    /**
     * Absorb tools registered after construction (e.g. late-registered MCP tools),
     * stubbing each so it participates in the proxy scheme. Existing entries keep
     * their pristine full schema and are never overwritten here.
     */
    absorbNewTools() {
        const seen = new Set(this.catalog.keys());
        const schemas = this.ctx.tools.schemas(undefined);
        for (const schema of schemas) {
            if (schema.name.startsWith('use_') || schema.name.startsWith('tt_'))
                continue;
            const handle = `tt_${schema.name}`;
            if (seen.has(handle))
                continue; // already cataloged; preserve its full schema
            const toolName = schema.name.startsWith('tt_') ? schema.name.slice(3) : schema.name;
            if (this.isExempt(toolName))
                continue;
            if (!schema.parameters || Object.keys(schema.parameters).length === 0)
                continue;
            // Capture the original full schema for the later swap-in.
            const originalDef = this.ctx.tools.get(toolName);
            if (originalDef) {
                this.originals.set(toolName, originalDef);
                // Clear any existing registration in this slot so our empty stub can be
                // registered without an "already registered" collision.
                try {
                    const clearDisposer = this.ctx.tools.register({ ...originalDef });
                    clearDisposer();
                }
                catch (err) {
                    console.error(`[dsh-tiny-tool] failed to clear \`${toolName}\`: ${String(err)}`);
                }
            }
            // Register the empty proxy stub under the model-facing name.
            try {
                const disposer = this.ctx.tools.register({
                    name: toolName,
                    description: `Invoke to access \`${toolName}\`.`,
                    parameters: {},
                    output: { schema: { type: 'string' }, render: textRender },
                    execute: async () => undefined,
                });
                this.proxies.set(toolName, disposer);
            }
            catch (err) {
                console.error(`[dsh-tiny-tool] failed to register proxy \`${toolName}\`: ${String(err)}`);
            }
            // Record the full schema so the guard can route it and assemble can emit it once revealed.
            this.catalog.set(handle, { name: handle, description: schema.description ?? '', parameters: schema.parameters });
        }
    }
    /**
     * Register one empty proxy stub per non-exempt, parametered tool. Each stub
     * occupies the tool's name so the model sees `{}` params; the original
     * full-schema definition is captured for re-add on first call.
     */
    registerProxies() {
        this.snapshotCatalog();
        for (const [handle, entry] of this.catalog) {
            const toolName = handle.slice(3); // strip `tt_` -> model-facing name
            if (this.isExempt(toolName))
                continue;
            if (!entry.parameters || Object.keys(entry.parameters).length === 0)
                continue;
            // Capture the original full-schema definition for the later swap-in.
            const originalDef = this.ctx.tools.get(toolName);
            if (originalDef) {
                this.originals.set(toolName, originalDef);
                // Clear any existing registration in this slot so our empty stub can be
                // registered without an "already registered" collision.
                try {
                    const clearDisposer = this.ctx.tools.register({ ...originalDef });
                    clearDisposer();
                }
                catch (err) {
                    console.error(`[dsh-tiny-tool] failed to clear \`${toolName}\`: ${String(err)}`);
                }
            }
            // Register the empty proxy stub under the model-facing name.
            try {
                const disposer = this.ctx.tools.register({
                    name: toolName,
                    description: `Invoke to access \`${toolName}\`.`,
                    parameters: {},
                    output: { schema: { type: 'string' }, render: textRender },
                    execute: async () => undefined,
                });
                this.proxies.set(toolName, disposer);
            }
            catch (err) {
                console.error(`[dsh-tiny-tool] failed to register proxy \`${toolName}\`: ${String(err)}`);
            }
        }
    }
    /**
     * Transform one settled assembly: non-exempt, unrevealed tools render as stubs
     * (truncated description, empty params `{}`); revealed tools (schema swapped
     * in via the guard) render with their complete schema; exempt tools keep full.
     */
    async assemble(assembly, _scope, next) {
        // Absorb any tools registered after construction (no re-snapshot of the
        // pristine catalog — that would clobber captured full schemas with stubs).
        this.absorbNewTools();
        if (this.catalog.size === 0)
            return assembly;
        const tools = assembly.tools ?? [];
        const stubbedTools = tools
            .filter(tool => !tool.name.startsWith('tt_') && !tool.name.startsWith('use_'))
            .map((tool) => {
            const lookupKey = tool.name.startsWith('tt_') ? tool.name : `tt_${tool.name}`;
            const entry = this.catalog.get(lookupKey);
            // Unknown tool — keep its full schema intact.
            if (entry === undefined) {
                return {
                    name: tool.name,
                    description: extractFirstSentence(tool.description ?? ''),
                    parameters: {},
                };
            }
            // Revealed / swapped-in tools and exempt tools keep their complete schema.
            if (this.revealed.has(tool.name) || this.isExempt(tool.name)) {
                return { name: tool.name, description: entry.description, parameters: entry.parameters };
            }
            // Everything else is a proxy stub (empty params).
            return {
                name: tool.name.startsWith('tt_') ? tool.name.slice(3) : tool.name,
                description: extractFirstSentence(entry.description),
                parameters: {},
            };
        });
        // Include any catalog tools not present in the assembly.
        for (const entry of this.catalog.values()) {
            const lookupKey = entry.name.startsWith('tt_') ? entry.name.slice(3) : entry.name;
            if (tools.some((t) => t.name === lookupKey || t.name === entry.name))
                continue;
            if (this.revealed.has(lookupKey) || this.isExempt(lookupKey)) {
                stubbedTools.push({ name: lookupKey, description: entry.description, parameters: entry.parameters });
                continue;
            }
            stubbedTools.push({
                name: lookupKey,
                description: extractFirstSentence(entry.description),
                parameters: {},
            });
        }
        // Allow downstream listeners (e.g., mnemon) to run before we override tools.
        const result = next ? await next(assembly, _scope) : assembly;
        return { ...result, tools: stubbedTools };
    }
}
//# sourceMappingURL=engine.js.map