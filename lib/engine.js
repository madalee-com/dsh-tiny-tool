/**
 * The engine that captures the full catalog and transforms assemblies.
 * @module dsh-tiny-tool/engine
 */
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
    // Object with properties: recurse into each property
    if ('properties' in obj && Array.isArray(obj.properties)) {
        const minified = { ...obj };
        if (Array.isArray(minified.properties)) {
            minified.properties = minified.properties.map(p => minifySchema(p));
        }
        return minified;
    }
    // Object with properties map
    if ('properties' in obj && typeof obj.properties === 'object' && obj.properties !== null) {
        const minified = { ...obj };
        const props = obj.properties;
        const minifiedProps = {};
        for (const [key, value] of Object.entries(props)) {
            minifiedProps[key] = minifySchema(value);
        }
        minified.properties = minifiedProps;
        return minified;
    }
    // Array items
    if ('items' in obj) {
        const minified = { ...obj };
        minified.items = minifySchema(obj.items);
        return minified;
    }
    // Union schemas
    for (const key of ['oneOf', 'allOf', 'anyOf']) {
        if (key in obj && Array.isArray(obj[key])) {
            const minified = { ...obj };
            minified[key] = obj[key].map(s => minifySchema(s));
            return minified;
        }
    }
    return schema;
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
    constructor(ctx, config = {}) {
        this.ctx = ctx;
        if (config.exemptTools) {
            for (const name of config.exemptTools) {
                this.exemptTools.add(name);
            }
        }
        // Register the assemble hook explicitly
        ctx.on('system-prompt/assemble', this.assemble.bind(this));
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
 
         // Use assembly.tools as the primary source of truth for transformation.
         // The catalog may be incomplete (e.g., tools registered after snapshot),
         // so we transform all assembly tools directly and only update the catalog
         // for tools we can capture.
         const tools = assembly.tools ?? [];
         const stubbedTools = tools.map(tool => {
             // Update catalog with current schema (may have changed)
             const desc = tool.description ?? ' ';
             const params = tool.parameters ?? {};
             this.catalog.set(tool.name, { name: tool.name, description: desc, parameters: params });
             if (this.exemptTools.has(tool.name)) {
                 return { name: tool.name, description: desc, parameters: params };
             }
             return {
                 name: tool.name,
                 description: ' ',
                 parameters: minifySchema(params),
             };
         });
         return { ...assembly, tools: stubbedTools };
     }
}
//# sourceMappingURL=engine.js.map