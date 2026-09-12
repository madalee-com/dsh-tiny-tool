import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/bridge.ts
/** The bridge tool names. */
const BRIDGE_NAMES = ["tool_search", "tool_describe"];
function textRender(_args, value) {
	return [{
		type: "text",
		text: typeof value === "string" ? value : JSON.stringify(value)
	}];
}
function errorMessage(error) {
	if (error instanceof Error) return error.message;
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
		describe: (name) => engine.describe(name)
	};
	const disposers = [ctx.tools.register(defineTool({
		name: "tool_search",
		description: "Always use this to find the right tool for the job.",
		parameters: { query: {
			type: "string",
			required: true
		} },
		output: {
			schema: { type: "string" },
			render: textRender
		},
		async execute(args, exec) {
			const { query } = args;
			try {
				const matches = deps.search(query);
				return JSON.stringify({ matches });
			} catch (error) {
				return JSON.stringify({ error: errorMessage(error) });
			}
		}
	})), ctx.tools.register(defineTool({
		name: "tool_describe",
		description: "Always use to get tool descriptions or argument details.",
		parameters: { name: {
			type: "string",
			required: true
		} },
		output: {
			schema: { type: "string" },
			render: textRender
		},
		async execute(args, exec) {
			const { name } = args;
			const schema = deps.describe(name);
			if (schema === void 0) return JSON.stringify({ error: `unknown tool "${name}"` });
			return JSON.stringify(schema);
		}
	}))];
	return () => {
		for (const dispose of disposers) dispose();
	};
}
//#endregion
//#region src/engine.ts
/**
* Minify a JSON Schema by stripping descriptive metadata while preserving
* structural typing (property names, types, required fields).
*/
function minifySchema(schema) {
	if (schema === null || schema === void 0) return schema;
	if (typeof schema !== "object") return schema;
	const obj = schema;
	if (!("properties" in obj) && !("items" in obj) && !("oneOf" in obj) && !("allOf" in obj) && !("anyOf" in obj)) {
		const minified = {};
		for (const key of Object.keys(obj)) {
			if (key === "description" || key === "default" || key === "enum" || key === "const" || key === "title" || key === "examples" || key === "pattern" || key === "format") continue;
			minified[key] = obj[key];
		}
		return minified;
	}
	const stripped = {};
	for (const [k, v] of Object.entries(obj)) if (![
		"description",
		"title",
		"examples",
		"pattern",
		"format"
	].includes(k)) stripped[k] = v;
	if ("properties" in stripped && Array.isArray(stripped.properties)) {
		const minified = { ...stripped };
		if (Array.isArray(minified.properties)) minified.properties = minified.properties.map((p) => minifySchema(p));
		return minified;
	}
	if ("properties" in stripped && typeof stripped.properties === "object" && stripped.properties !== null) {
		const minified = { ...stripped };
		const props = stripped.properties;
		const minifiedProps = {};
		for (const [key, value] of Object.entries(props)) minifiedProps[key] = minifySchema(value);
		minified.properties = minifiedProps;
		return minified;
	}
	if ("items" in stripped) {
		const minified = { ...stripped };
		minified.items = minifySchema(stripped.items);
		return minified;
	}
	for (const key of [
		"oneOf",
		"allOf",
		"anyOf"
	]) if (key in stripped && Array.isArray(stripped[key])) {
		const minified = { ...stripped };
		minified[key] = stripped[key].map((s) => minifySchema(s));
		return minified;
	}
	return schema;
}
/**
* Extract the first sentence from a description, including its terminating punctuation.
*/
function extractFirstSentence(description) {
	return description.match(/^([^.*!?]*[.!?])/)?.[1] ?? "";
}
/**
* The dsh-tiny-tool engine: snapshots the tool catalog and transforms every
* system-prompt assembly to hide all tool descriptions behind minimum versions,
* except for any explicitly exempted tools.
*/
var TinyToolEngine = class {
	ctx;
	catalog = /* @__PURE__ */ new Map();
	exemptTools = /* @__PURE__ */ new Set();
	exemptPrefixes = /* @__PURE__ */ new Set();
	constructor(ctx, config = {}) {
		this.ctx = ctx;
		for (const name of BRIDGE_NAMES) this.exemptTools.add(name);
		if (config.exemptTools) for (const name of config.exemptTools) this.exemptTools.add(name);
		if (config.exemptPrefixes) for (const prefix of config.exemptPrefixes) this.exemptPrefixes.add(prefix);
		ctx.on("system-prompt/assemble", this.assemble.bind(this));
	}
	/**
	* Check if a tool name should be exempt from minification.
	*/
	isExempt(name) {
		if (this.exemptTools.has(name)) return true;
		for (const prefix of this.exemptPrefixes) if (name.startsWith(prefix)) return true;
		return false;
	}
	/**
	* Capture the current full tool catalog from the registry.
	* Runs on each assemble() call to ensure tools are registered before capture.
	*/
	snapshotCatalog() {
		const schemas = this.ctx.tools.schemas(void 0);
		for (const schema of schemas) this.catalog.set(schema.name, {
			name: schema.name,
			description: schema.description ?? "",
			parameters: schema.parameters ?? {}
		});
	}
	/**
	* Return the full schema for one tool, or undefined if unknown.
	* Used by the `tool_describe` bridge tool.
	* @param name - the tool name.
	* @returns the full schema, or undefined.
	*/
	describe(name) {
		const entry = this.catalog.get(name);
		if (entry === void 0) return void 0;
		return {
			name: entry.name,
			description: entry.description,
			parameters: entry.parameters
		};
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
		for (const entry of this.catalog.values()) if (entry.name.toLowerCase().includes(lower) || entry.description.toLowerCase().includes(lower)) matches.push(entry.name);
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
		this.snapshotCatalog();
		if (this.catalog.size === 0) return assembly;
		let agent;
		try {
			agent = this.ctx.agents?.currentInitiator();
		} catch {
			agent = void 0;
		}
		if (agent !== void 0) {
			if ((agent.options?.subagentDepth ?? (agent.session?.header)?.delegationDepth ?? 0) > 0) return assembly;
		}
		const tools = assembly.tools ?? [];
		const stubbedTools = tools.map((tool) => {
			const entry = this.catalog.get(tool.name);
			if (entry === void 0) {
				const desc = tool.description ?? "";
				return {
					name: tool.name,
					description: extractFirstSentence(desc) + " Must use tool_describe before first usage!",
					parameters: minifySchema(tool.parameters)
				};
			}
			if (this.isExempt(entry.name)) return {
				name: entry.name,
				description: entry.description,
				parameters: entry.parameters
			};
			return {
				name: entry.name,
				description: extractFirstSentence(entry.description) + " Must use tool_describe before first usage!",
				parameters: minifySchema(entry.parameters)
			};
		});
		for (const entry of this.catalog.values()) if (!tools.some((t) => t.name === entry.name)) stubbedTools.push({
			name: entry.name,
			description: this.isExempt(entry.name) ? entry.description : extractFirstSentence(entry.description) + " Must use tool_describe before first usage!",
			parameters: minifySchema(entry.parameters)
		});
		return {
			...assembly,
			tools: stubbedTools
		};
	}
};
//#endregion
//#region src/index.ts
const name = "dsh-tiny-tool";
const inject = ["tools"];
/** Settings namespace for plugin configuration. */
const TINY_TOOL_SETTINGS_NS = "tiny-tool-config";
/** Schema for the tiny-tool configuration. */
const TinyToolConfigSchema = z.object({
	exemptTools: z.array(z.string()),
	exemptPrefixes: z.array(z.string())
}).loose();
/**
* Apply the plugin: snapshot the full catalog, register bridge tools, hook
* the system-prompt/assemble waterfall, and register settings for UI config.
* @param ctx - the plugin context.
* @param config - plugin configuration (see TinyToolConfig).
* @returns the engine instance.
*/
function apply(ctx, config = {}) {
	const engine = new TinyToolEngine(ctx, config);
	registerBridgeTools(ctx, engine);
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings?.register?.(TINY_TOOL_SETTINGS_NS, TinyToolConfigSchema, { base: {} });
	});
	return engine;
}
//#endregion
export { TINY_TOOL_SETTINGS_NS, TinyToolConfigSchema, apply, inject, name };

//# sourceMappingURL=index.mjs.map