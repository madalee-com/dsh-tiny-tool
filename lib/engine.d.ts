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
    constructor(ctx: Context, config?: TinyToolConfig);
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
     * hidden-until-called. Calling it registers the tool's full definition in the
     * calling agent's scope (so the model sees its full parameters on the next
     * assembly) and denies the call once so the host re-assembles and the model
     * retries with arguments. Everything else passes through unchanged.
     * @param exec - the in-flight execution.
     * @param next - downstream decision in the waterfall.
     * @returns `deny` for an unrevealed managed tool; otherwise passthrough.
     */
    private preExecute;
    /**
     * Check if a tool name should be exempt from the trim scheme.
     */
    private isExempt;
    /**
     * Capture the current full tool catalog from the registry.
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