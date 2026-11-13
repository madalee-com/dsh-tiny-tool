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
     * Access the raw (unwrapped) ToolsService through the traceable proxy and
     * wrap its `definitions` method so managed tools project trimmed schemas to
     * the model while keeping full definitions for execution and reveal. Also
     * wraps `register` to keep the catalog fresh for tools added after apply().
     */
    private patchToolsService;
    /** True when the current initiator is a subagent (needs full tool schemas). */
    private isSubagentScope;
    /** Populate the catalog from a raw ToolsService's global definitions. */
    private snapshotCatalogFrom;
    /** Return a shallow clone of `def` with trimmed description and empty parameters,
     * unless the tool is revealed or exempt (keep full schema). */
    private trimDefinition;
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
}
//# sourceMappingURL=engine.d.ts.map