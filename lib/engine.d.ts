/**
 * The dsh-tiny-tool engine: captures the full catalog and transforms assemblies
 * so each non-exempt, non-revealed tool is shown under its real name with a
 * trimmed description and empty `{}` parameters. Calling such a tool "unhides"
 * it for the rest of the session by registering its full definition scoped to
 * the calling agent; the host re-assembles on the retry, so the model then sees
 * the full parameters before the current turn proceeds.
 * @module dsh-tiny-tool/engine
 */
import { Context } from '@deepseek-ai/cordis';
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt';
export type ToolSchema = {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
};
/** One captured catalog entry — the full schema retained for re-exposure in later assemblies. */
export interface CatalogEntry {
    name: string;
    description: string;
    parameters: unknown;
}
/**
 * Plugin configuration.
 */
export interface TinyToolConfig {
    /** Tool names to keep fully visible (do not trim descriptions). */
    exemptTools?: string[];
    /** Tool name prefixes to keep fully visible (e.g. ['mnemon_']). */
    exemptPrefixes?: string[];
    /**
     * Automatically exclude a set of basic tools from the trim scheme, keeping them
     * fully visible under their real name with full parameters. Defaults to true.
     */
    keepTheBasics?: boolean;
}
/**
 * The dsh-tiny-tool engine.
 */
export declare class TinyToolEngine {
    private readonly ctx;
    private readonly catalog;
    private readonly exemptTools;
    private readonly exemptPrefixes;
    /** Base tool names whose full schema has been revealed to the model this session. */
    private readonly revealed;
    /** Original AgentLoop.buildRequest, saved for restoration if needed. */
    private originalBuildRequest?;
    constructor(ctx: Context, config?: TinyToolConfig);
    /**
     * Monkey-patch `ReactLoopAgent.buildRequest` to trim tool schemas before they
     * reach the model. Agents are tracked in the `ctx.agents` registry; new agents
     * enter via `agents.enter(agent, owner)`, and existing agents are retrievable
     * via `agents.list()`. We patch each ReactLoopAgent's buildRequest when it is
     * entered, and also patch any already-live agents.
     *
     * The traceable proxy's set trap forwards property assignments to the raw
     * AgentRegistry instance, so patching `ctx.agents.enter` overrides the
     * internal creation path used by AgentLoop.initializeAgent.
     */
    private patchBuildRequest;
    /**
     * Patch a ReactLoopAgent's step method to trim tool schemas in decision.assembly.tools
     * BEFORE prepareRequest finalizes the config. This avoids the "config changed before
     * adapter dispatch" error that occurs when tools are modified after config preparation.
     * Guards against double-patching with a marker property.
     */
    private patchAgentStep;
    /**
     * Return a trimmed copy of the tool schemas: revealed/exempt tools keep their
     * full schema, everything else becomes a stub (first-sentence description +
     * empty parameters) so the model cannot see implementation details.
     */
    private trimTools;
    /**
     * Reveal a base tool's full schema to exactly the calling agent by registering
     * its full definition in that agent's scope, then mark it revealed for the
     * rest of the session. Falls back to a plain reveal (mark + no register) when
     * the agent context or the base definition is unavailable.
     * @param name - the base tool name being revealed.
     * @param exec - the in-flight execution, providing the caller's agent scope.
     */
    private unhideAgentScoped;
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
    private preExecute;
    /**
     * Check if a tool name should be exempt from the trim scheme.
     */
    private isExempt;
    /**
      * Check whether a tool's schema is effectively empty — no arguments needed.
      * Handles both bare `{}` and JSON Schema variants like
      * `{type:'object', properties:{}}` where there are no required fields.
      */
    private isTrivialParameters;
    /**
     * Capture the current full tool catalog from the registry.
     *
     * Tries multiple fallback strategies because `ctx.tools.schemas()` may throw
     * or return an empty array when accessed from the plugin's child fiber
     * context (harness cordis/dsh-* version drift).
     */
    private snapshotCatalog;
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
    assemble(assembly: PromptAssembly, _scope?: unknown, next?: (...args: unknown[]) => Promise<PromptAssembly>): Promise<PromptAssembly>;
}
//# sourceMappingURL=engine.d.ts.map