/**
 * The engine that captures the full catalog and transforms assemblies.
 * @module dsh-tiny-tool/engine
 */
import { BRIDGE_NAMES } from './bridge.js';
/**
 * Minify a JSON Schema by stripping descriptive metadata while preserving
 * structural typing (property names, types, required fields).
 */
function minifySchema(schema) {
    if (schema === null || schema === undefined)
        return schema;
    if (typeof schema !== 'object')
        return schema;
    const obj = schema;
    // Leaf node: strip descriptive fields but keep type
    if (!('properties' in obj) && !('items' in obj) && !('oneOf' in obj) && !('allOf' in obj) && !('anyOf' in obj)) {
        const minified = {};
        for (const key of Object.keys(obj)) {
            if (key === 'description' || key === 'default' || key === 'enum' || key === 'const' || key === 'title' || key === 'examples' || key === 'pattern' || key === 'format')
                continue;
            minified[key] = obj[key];
        }
        return minified;
    }
    // Strip descriptive keys from root before recursing
    const keepKeys = new Set(['type', 'properties', 'items', 'required', 'oneOf', 'allOf', 'anyOf', 'additionalProperties', 'pattern', 'format', 'minimum', 'maximum', 'default', 'enum', 'const', 'title', 'examples']);
    const stripped = {};
    for (const [k, v] of Object.entries(obj)) {
        if (!['description', 'title', 'examples', 'pattern', 'format'].includes(k)) {
            stripped[k] = v;
        }
    }
    // Object with properties: recurse into each property
    if ('properties' in stripped && Array.isArray(stripped.properties)) {
        const minified = { ...stripped };
        if (Array.isArray(minified.properties)) {
            minified.properties = minified.properties.map(p => minifySchema(p));
        }
        return minified;
    }
    // Object with properties map
    if ('properties' in stripped && typeof stripped.properties === 'object' && stripped.properties !== null) {
        const minified = { ...stripped };
        const props = stripped.properties;
        const minifiedProps = {};
        for (const [key, value] of Object.entries(props)) {
            minifiedProps[key] = minifySchema(value);
        }
        minified.properties = minifiedProps;
        return minified;
    }
    // Array items
    if ('items' in stripped) {
        const minified = { ...stripped };
        minified.items = minifySchema(stripped.items);
        return minified;
    }
    // Union schemas
    for (const key of ['oneOf', 'allOf', 'anyOf']) {
        if (key in stripped && Array.isArray(stripped[key])) {
            const minified = { ...stripped };
            minified[key] = stripped[key].map(s => minifySchema(s));
            return minified;
        }
    }
    return schema;
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
 * system-prompt assembly to hide all tool descriptions behind minimum versions,
 * except for any explicitly exempted tools.
 */
export class TinyToolEngine {
    ctx;
    catalog = new Map();
    exemptTools = new Set();
    exemptPrefixes = new Set();
    constructor(ctx, config = {}) {
        this.ctx = ctx;
        // Always exempt bridge tools — they need descriptions to function
        for (const name of BRIDGE_NAMES) {
            this.exemptTools.add(name);
        }
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
        // Register the assemble hook explicitly
        ctx.on('system-prompt/assemble', this.assemble.bind(this));
    }
    /**
     * Check if a tool name should be exempt from minification.
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
            this.catalog.set(schema.name, {
                name: schema.name,
                description: schema.description ?? '',
                parameters: schema.parameters ?? {},
            });
        }
    }
    /**
     * Return the full schema for one tool, or undefined if unknown.
     * Used by the `tool_describe` bridge tool.
     * @param name - the tool name.
     * @returns the full schema, or undefined.
     */
    describe(name) {
        const entry = this.catalog.get(name);
        if (entry === undefined)
            return undefined;
        return { name: entry.name, description: entry.description, parameters: entry.parameters };
    }
    /**
     * Keyword-search the catalog. Returns matching tool names.
     * Used by the `tool_search` bridge tool.
     * @param query - the search query (case-insensitive substring match).
     * @returns matching tool names.
     */
    search(query) {
        const lower = query.toLowerCase();
        const matches = [];
        for (const entry of this.catalog.values()) {
            if (entry.name.toLowerCase().includes(lower)
                || entry.description.toLowerCase().includes(lower)) {
                matches.push(entry.name);
            }
        }
        return matches;
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
    async assemble(assembly, _scope) {
        // Re-snapshot catalog fresh on each assemble to catch all registered tools
        this.snapshotCatalog();
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
        const tools = assembly.tools ?? [];
        const stubbedTools = tools.map(tool => {
            const entry = this.catalog.get(tool.name);
            if (entry === undefined) {
                // Tool not in catalog — still truncate description and add warning
                const desc = (tool.description ?? '');
                return {
                    name: tool.name,
                    description: extractFirstSentence(desc) + ' Must use tool_describe before first usage!',
                    parameters: minifySchema(tool.parameters),
                };
            }
            if (this.isExempt(entry.name)) {
                return { name: entry.name, description: entry.description, parameters: entry.parameters };
            }
            return {
                name: entry.name,
                description: extractFirstSentence(entry.description) + ' Must use tool_describe before first usage!',
                parameters: minifySchema(entry.parameters),
            };
        });
        // Also include any catalog tools not in the assembly (edge case)
        for (const entry of this.catalog.values()) {
            if (!tools.some(t => t.name === entry.name)) {
                stubbedTools.push({
                    name: entry.name,
                    description: this.isExempt(entry.name) ? entry.description : extractFirstSentence(entry.description) + ' Must use tool_describe before first usage!',
                    parameters: minifySchema(entry.parameters),
                });
            }
        }
        return { ...assembly, tools: stubbedTools };
    }
}
//# sourceMappingURL=engine.js.map