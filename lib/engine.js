/**
 * The dsh-tiny-tool engine: captures the full catalog and transforms assemblies
 * so each non-exempt, non-revealed tool is shown under its real name with a
 * trimmed description and empty `{}` parameters. Calling such a tool "unhides"
 * it for the rest of the session by registering its full definition scoped to
 * the calling agent; the host re-assembles on the retry, so the model then sees
 * the full parameters before the current turn proceeds.
 * @module dsh-tiny-tool/engine
 */
import { symbols } from '@deepseek-ai/cordis';
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
        // Under 0.2.2-rc.1 the `system-prompt/assemble` hook cannot trim tools:
        // providers append their schemas AFTER the waterfall, overriding any
        // hook-set `tools`. Instead we wrap the raw ToolsService's `definitions()`
        // projection so managed tools are trimmed at schema-project time (no
        // duplicate entries). Reveal-on-call still works via scoped shadow-registration.
        this.patchToolsService();
        // Reveal-on-execute: intercept calls to unrevealed, managed tools so the
        // tool's full definition can be registered in the calling agent's scope.
        const boundPreExecute = this.preExecute.bind(this);
        ctx.on('tools/pre-execute', (exec, next) => {
            return boundPreExecute(exec, next);
        });
    }
    /**
     * Access the raw (unwrapped) ToolsService through the traceable proxy and
     * wrap its `definitions` method so managed tools project trimmed schemas to
     * the model while keeping full definitions for execution and reveal. Also
     * wraps `register` to keep the catalog fresh for tools added after apply().
     */
    patchToolsService() {
        const toolsProxy = this.ctx.tools;
        // The traceable proxy exposes its underlying target via symbols.original.
        const rawTools = toolsProxy?.[symbols.original] ?? toolsProxy;
        if (!rawTools || typeof rawTools.definitions !== 'function')
            return;
        // Snapshot the full catalog from current global definitions (before trimming).
        try {
            this.snapshotCatalogFrom(rawTools);
        }
        catch { }
        // Keep the catalog updated for tools registered after apply().
        // NOTE: Wrapping rawTools.register causes a double-registration bug under
        // 0.2.2-rc.1 (the traceable proxy's shadow-wrapping intercepts the call
        // twice). We rely on snapshotCatalogFrom() at apply time and on the
        // tools/pre-execute hook to discover tools dynamically instead.
        // const originalRegister = rawTools.register?.bind(rawTools)
        // if (originalRegister) {
        //   rawTools.register = (definition: any, options?: any) => {
        //     if (definition?.name && !this.catalog.has(definition.name)) {
        //       this.catalog.set(definition.name, {
        //         name: definition.name,
        //         description: definition.description ?? '',
        //         parameters: definition.parameters ?? definition.output?.schema?.properties ?? {},
        //       })
        //     }
        //     return originalRegister(definition, options)
        //   }
        // }
        // Trim managed tools at projection time; subagents keep full schemas.
        const originalDefinitions = rawTools.definitions.bind(rawTools);
        rawTools.definitions = (scope, toolSet) => {
            const defs = originalDefinitions(scope, toolSet);
            if (this.isSubagentScope(scope))
                return defs;
            return defs.map((def) => this.trimDefinition(def));
        };
    }
    /** True when the current initiator is a subagent (needs full tool schemas). */
    isSubagentScope(scope) {
        try {
            const agents = this.ctx.agents;
            if (!agents?.currentInitiator)
                return false;
            const initiator = agents.currentInitiator();
            const depth = initiator?.options?.subagentDepth
                ?? initiator?.session?.header?.delegationDepth
                ?? 0;
            return depth > 0;
        }
        catch {
            return false;
        }
    }
    /** Populate the catalog from a raw ToolsService's global definitions. */
    snapshotCatalogFrom(rawTools) {
        try {
            const defs = rawTools.definitions(undefined);
            if (!Array.isArray(defs))
                return;
            for (const d of defs) {
                if (!d?.name || d.name.startsWith('use_'))
                    continue;
                this.catalog.set(d.name, {
                    name: d.name,
                    description: d.description ?? '',
                    parameters: d.parameters ?? d.output?.schema?.properties ?? {},
                });
            }
        }
        catch (e) {
            // Best-effort; catalog may be empty if definitions() fails from a child fiber.
        }
    }
    /** Return a shallow clone of `def` with trimmed description and empty parameters,
     * unless the tool is revealed or exempt (keep full schema). */
    trimDefinition(def) {
        if (!def?.name)
            return def;
        if (this.revealed.has(def.name) || this.isExempt(def.name))
            return def;
        return {
            ...def,
            description: extractFirstSentence(def.description ?? ''),
            parameters: {},
        };
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
        // Basic tools are pre-revealed; exempt tools never get trimmed — both pass through.
        if (this.revealed.has(name) || this.isExempt(name)) {
            return next();
        }
        // Any other tool is managed: fetch its full definition dynamically (the static
        // catalog may be incomplete if definitions() ran before other plugins registered).
        const base = this.ctx.tools.get(name);
        if (!base) {
            return next();
        } // unknown/unmanaged — passthrough
        // Genuinely parameterless tools (no required params) don't need a reveal round-trip;
        // allow them. Tools whose params were trimmed to {} but originally had required
        // parameters get denied once so the host re-assembles with the full schema.
        const hasRequired = Array.isArray(base.parameters?.required) && base.parameters.required.length > 0;
        if (!hasRequired) {
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
}
//# sourceMappingURL=engine.js.map