/**
 * The dsh-tiny-tool engine: captures the full catalog and transforms assemblies
 * so each non-exempt, non-revealed tool is shown under its real name with a
 * trimmed description and empty `{}` parameters. Calling such a tool "unhides"
 * it for the rest of the session by registering its full definition scoped to
 * the calling agent; the host re-assembles on the retry, so the model then sees
 * the full parameters before the current turn proceeds.
 * @module dsh-tiny-tool/engine
 */
/** Render a tool result as plain text so the model can read it directly. */
const KEEP_THE_BASICS_TOOLS = [
    'bash',
    'todo_write',
    'ask_user_question',
    'edit',
    'write',
    'read',
    'present',
    'skill',
    'glob',
    'grep',
];
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
 * The dsh-tiny-tool engine.
 */
export class TinyToolEngine {
    ctx;
    catalog = new Map();
    exemptTools = new Set();
    exemptPrefixes = new Set();
    /** Base tool names whose full schema has been revealed to the model this session. */
    revealed = new Set();
    constructor(ctx, config = {}) {
        this.ctx = ctx;
        if (config.exemptTools) {
            for (const name of config.exemptTools)
                this.exemptTools.add(name);
        }
        if (config.exemptPrefixes) {
            for (const prefix of config.exemptPrefixes)
                this.exemptPrefixes.add(prefix);
        }
        // Pre-populate revealed so these basic tools are never trimmed.
        const keepTheBasics = config.keepTheBasics !== false;
        if (keepTheBasics) {
            for (const name of KEEP_THE_BASICS_TOOLS)
                this.revealed.add(name);
        }
        // Register the assemble hook explicitly.
        ctx.on('system-prompt/assemble', this.assemble.bind(this));
        // Reveal-on-execute: intercept calls to unrevealed, managed tools so the
        // tool's full definition can be registered in the calling agent's scope.
        ctx.on('tools/pre-execute', this.preExecute.bind(this));
    }
    /**
     * Reveal a base tool's full schema to exactly the calling agent by registering
     * its full definition in that agent's scope, then mark it revealed for the
     * rest of the session. Falls back to a plain reveal (mark + no register) when
     * the agent context or the base definition is unavailable.
     * @param name - the base tool name being revealed.
     * @param exec - the in-flight execution, providing the caller's agent scope.
     */
    unhideAgentScoped(name, exec) {
        const execLike = exec;
        const agentTools = execLike.agent?.ctx?.tools;
        // `get` without a scope resolves the global base definition, which carries
        // the real `execute` + canonical `output`. Registering it in the caller's
        // scope shadows that base only for this agent.
        const base = agentTools ? this.ctx.tools.get(name) : undefined;
        if (agentTools && base && agentTools.register) {
            agentTools.register(base);
        }
        this.revealed.add(name);
    }
    /**
     * `tools/pre-execute` waterfall: an unrevealed, non-exempt managed tool is
     * hidden-until-called. Tools with trivial (empty `{}`) parameters are
     * allowed through on first call and silently marked revealed — their full
     * description then appears only on the next assemble. Non-trivial tools
     * are registered in the calling agent's scope and denied once, triggering
     * a host re-assemble so the model retries with arguments. Everything else
     * passes through unchanged.
     * @param exec - the in-flight execution.
     * @param next - downstream decision in the waterfall.
     * @returns `deny` for unrevealed tools with non-trivial parameters; lazily revealed for empty-parameter tools (no deny); otherwise passthrough.
     */
    async preExecute(exec, next) {
        const name = exec.name;
        if (!this.catalog.has(name))
            return next();
        if (this.revealed.has(name) || this.isExempt(name))
            return next();
        // Lazy-reveal: tools with trivial parameters are allowed through on first
        // call (no deny/re-assemble), but still marked revealed so their full
        // description appears on the next assemble.
        const entry = this.catalog.get(name);
        if (entry && this.isTrivialParameters(entry.parameters)) {
            this.revealed.add(name);
            return next();
        }
        this.unhideAgentScoped(name, exec);
        return { kind: 'deny', reason: `${name} is now enabled with its full parameters; call it again with arguments.` };
    }
    /**
     * Check if a tool name should be exempt from the trim scheme.
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
      * Check whether a tool's schema is effectively empty — no arguments needed.
      * Handles both bare `{}` and JSON Schema variants like
      * `{type:'object', properties:{}}` where there are no required fields.
      */
    isTrivialParameters(params) {
        if (params == null)
            return true;
        if (typeof params !== 'object' || Array.isArray(params))
            return false;
        const obj = params;
        // Non-empty `required` array means mandatory args exist.
        if (Array.isArray(obj.required) && obj.required.length > 0)
            return false;
        // Non-empty `properties` means named args exist.
        const props = obj.properties;
        if (props && typeof props === 'object' && !Array.isArray(props)) {
            if (Object.keys(props).length > 0)
                return false;
        }
        return true;
    }
    /**
     * Capture the current full tool catalog from the registry.
     */
    snapshotCatalog() {
        const schemas = this.ctx.tools.schemas(undefined);
        for (const schema of schemas) {
            // Skip any residual proxy stubs — they are emitted from their base tool,
            // never stored as catalog entries, so they can't re-nest on a later
            // assembly.
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
     * Transform one settled assembly: every non-exempt, non-revealed tool is shown
     * under its real name with a trimmed description and empty `{}` parameters,
     * while revealed tools and exempt tools keep their full schema. A model that
     * calls such a tool unhides it for the rest of the session (see
     * `preExecute`), where its full schema is re-exposed by the next assembly.
     * @param assembly - the settled assembly from the waterfall chain.
     * @param _scope - the calling agent scope (unused).
     * @returns the transformed assembly.
     */
    async assemble(assembly, _scope, next) {
        // Re-snapshot the catalog fresh on each assemble so we capture base tools
        // registered after apply(), before transforming in place.
        this.snapshotCatalog();
        if (this.catalog.size === 0)
            return assembly;
        // Skip transformation for subagent contexts — they need full tool schemas.
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
        // Populate the catalog from the assembly's own tools too, so we can trim any
        // tool not registered through ctx.tools.register (e.g., remote service
        // methods like read/write).
        const tools = assembly.tools ?? [];
        for (const tool of tools) {
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
        // Present base tools under their real name: revealed/exempt keep their full
        // schema; every other managed tool is trimmed to its first sentence with
        // empty `{}` parameters.
        const stubbedTools = tools
            .filter(tool => !tool.name.startsWith('use_'))
            .map(tool => {
            const entry = this.catalog.get(tool.name);
            if (entry === undefined) {
                const desc = (tool.description ?? '');
                return { name: tool.name, description: extractFirstSentence(desc), parameters: {} };
            }
            // Revealed and exempt tools keep their full schema.
            if (this.revealed.has(entry.name) || this.isExempt(entry.name)) {
                return { name: entry.name, description: entry.description, parameters: entry.parameters };
            }
            // Otherwise trim to the real name, first sentence, and empty params.
            return { name: entry.name, description: extractFirstSentence(entry.description), parameters: {} };
        });
        // Also include any catalog tools not present in the assembly (edge case).
        for (const entry of this.catalog.values()) {
            if (tools.some(t => t.name === entry.name))
                continue;
            if (this.revealed.has(entry.name) || this.isExempt(entry.name)) {
                stubbedTools.push({ name: entry.name, description: entry.description, parameters: entry.parameters });
            }
            else {
                stubbedTools.push({ name: entry.name, description: extractFirstSentence(entry.description), parameters: {} });
            }
        }
        // Call next() to allow downstream listeners (e.g., mnemon) to run
        const result = next ? await next(assembly, _scope) : assembly;
        return { ...result, tools: stubbedTools };
    }
}
//# sourceMappingURL=engine.js.map