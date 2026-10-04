/**
 * The engine that captures the full catalog and transforms assemblies.
 * @module dsh-tiny-tool/engine
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
/** Render a tool result as plain text so the model can read it directly. */
function textRender(_args, value) {
    return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }];
}
/**
 * Extract the first sentence from a description, including its terminating punctuation.
 */
function extractFirstSentence(description) {
    const match = description.match(/^([^.*!?]*[.!?])/);
    return match?.[1] ?? '';
}
/**
 * The dsh-tiny-tool engine: snapshots the tool catalog and transforms every
 * system-prompt assembly so each non-exempt, non-revealed tool appears as a
 * `use_<name>` proxy (truncated description, empty params `{}`). Calling a
 * proxy swaps in the real base tool with its full schema for the rest of the
 * session, where its full schema is re-exposed by the next assembly.
 */
export class TinyToolEngine {
    ctx;
    catalog = new Map();
    exemptTools = new Set();
    exemptPrefixes = new Set();
    /** Base tool names whose full schema has been revealed to the model this session. */
    revealed = new Set();
    /** One-time proxy disposer per base tool name, removed after its `use_<name>` is called. */
    proxies = new Map();
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
        // Register the assemble hook explicitly
        ctx.on('system-prompt/assemble', this.assemble.bind(this));
    }
    /**
     * Register a one-shot `use_<name>` proxy stub for every non-exempt tool.
     * Calling a proxy reveals the real base tool (full schema) for the rest of
     * the session and removes itself from the registry. Exempt tools keep their
     * full schemas untouched.
     */
    registerProxies() {
        this.snapshotCatalog();
        const registered = this.ctx.tools.schemas();
        // Capture mutable state as locals so the proxy `execute` closure can mutate
        // the session state without relying on a bound `this`.
        const revealed = this.revealed;
        const proxies = this.proxies;
        for (const entry of this.catalog.values()) {
            if (this.isExempt(entry.name))
                continue;
            // Guard against name clashes: skip tools whose proxy already exists.
            const proxyName = `use_${entry.name}`;
            if (registered.some(r => r.name === proxyName))
                continue;
            const baseName = entry.name;
            proxies.set(baseName, this.ctx.tools.register(defineTool({
                name: proxyName,
                description: `Invoke to enable ${baseName} with its full parameters.`,
                parameters: {},
                output: { schema: { type: 'string' }, render: textRender },
                async execute() {
                    // Swap in the real base tool: mark revealed (session), dispose this
                    // one-shot proxy, and instruct the model to call the real tool. Its
                    // full parameter schema is re-exposed by the next assembly once
                    // revealed, so it is intentionally not echoed here.
                    revealed.add(baseName);
                    const disposer = proxies.get(baseName);
                    if (disposer) {
                        disposer();
                        proxies.delete(baseName);
                    }
                    return JSON.stringify({
                        action: 'use',
                        tool: baseName,
                        message: `use ${baseName} instead`,
                    });
                },
            })));
        }
    }
    /**
     * Check if a tool name should be exempt from the proxy scheme.
     */
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
     * Capture the current full tool catalog from the registry.
     * Runs on each assemble() call to ensure tools are registered before capture.
     */
    snapshotCatalog() {
        const schemas = this.ctx.tools.schemas(undefined);
        for (const schema of schemas) {
            // Skip our own `use_<name>` proxy stubs — they are emitted from their base
            // tool, never stored as catalog entries, so they can't re-nest into
            // `use_use_<name>` on a later assembly.
            if (schema.name.startsWith('use_'))
                continue;
            this.catalog.set(schema.name, {
                name: schema.name,
                description: schema.description ?? '',
                parameters: schema.parameters ?? {},
            });
        }
    }
    /**
     * Transform one settled assembly: every non-exempt, non-revealed tool is
     * shown as a `use_<name>` proxy (truncated description, empty params `{}`),
     * while revealed tools and exempt tools keep their full schema. A model that
     * calls `use_<name>` swaps in the real base tool for the rest of the
     * session, where its full schema is re-exposed by the next assembly.
     * @param assembly - the settled assembly from the waterfall chain.
     * @param _scope - the calling agent scope (unused).
     * @returns the transformed assembly.
     */
    async assemble(assembly, _scope, next) {
        // Re-snapshot catalog fresh on each assemble to catch all registered tools,
        // including base tools registered after apply; then register `use_<name>`
        // proxies against the current catalog so they are dispatchable. Idempotent:
        // registerProxies() skips any proxy already present in ctx.tools.
        this.snapshotCatalog();
        this.registerProxies();
        if (this.catalog.size === 0)
            return assembly;
        // Skip transformation for subagent contexts — they need full tool schemas
        let agent;
        try {
            agent = this.ctx.agents?.currentInitiator();
        }
        catch {
            agent = undefined;
        }
        if (agent !== undefined) {
            const depth = (agent.options?.subagentDepth ?? agent.session?.header?.delegationDepth) ?? 0;
            if (depth > 0)
                return assembly;
        }
        // Transform tools in-place: use assembly.tools as source of truth,
        // falling back to catalog for any tools not in the assembly.
        // This prevents losing tools if the catalog is incomplete.
        // Also populate catalog from assembly.tools to capture tools not registered
        // through ctx.tools.register() (e.g., remote service methods like read/write).
        const tools = assembly.tools ?? [];
        for (const tool of tools) {
            // Ignore proxy stubs: they are rendered from their base tool, not stored.
            if (tool.name.startsWith('use_'))
                continue;
            if (!this.catalog.has(tool.name)) {
                this.catalog.set(tool.name, {
                    name: tool.name,
                    description: (tool.description ?? ''),
                    parameters: (tool.parameters ?? {}),
                });
            }
        }
        // Base tools become `use_<name>` proxies; our own proxy stubs are dropped
        // here (they were emitted from their base tool above) so they never re-nest.
        const stubbedTools = tools
            .filter(tool => !tool.name.startsWith('use_'))
            .map(tool => {
            const entry = this.catalog.get(tool.name);
            if (entry === undefined) {
                // Tool not in catalog — render a `use_<name>` proxy with truncated desc
                const desc = (tool.description ?? '');
                return {
                    name: `use_${tool.name}`,
                    description: extractFirstSentence(desc),
                    parameters: {},
                };
            }
            // Revealed tools keep their full schema; everything else becomes a proxy.
            if (this.revealed.has(entry.name) || this.isExempt(entry.name)) {
                return { name: entry.name, description: entry.description, parameters: entry.parameters };
            }
            return {
                name: `use_${entry.name}`,
                description: extractFirstSentence(entry.description),
                parameters: {},
            };
        });
        // Also include any catalog tools not in the assembly (edge case)
        for (const entry of this.catalog.values()) {
            if (tools.some(t => t.name === entry.name))
                continue;
            if (this.revealed.has(entry.name) || this.isExempt(entry.name)) {
                stubbedTools.push({ name: entry.name, description: entry.description, parameters: entry.parameters });
                continue;
            }
            stubbedTools.push({
                name: `use_${entry.name}`,
                description: extractFirstSentence(entry.description),
                parameters: {},
            });
        }
        // Call next() to allow downstream listeners (e.g., mnemon) to run
        const result = next ? await next(assembly, _scope) : assembly;
        return { ...result, tools: stubbedTools };
    }
}
//# sourceMappingURL=engine.js.map