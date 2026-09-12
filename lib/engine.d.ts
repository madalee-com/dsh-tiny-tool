/**
 * The engine that captures the full catalog and transforms assemblies.
 * @module dsh-tiny-tool/engine
 */
import { Context } from '@deepseek-ai/cordis';
export type ToolSchema = {
    name: string;
    description: string;
    parameters: unknown;
};
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt';
/** One captured catalog entry — the full schema kept for on-demand describe. */
export interface CatalogEntry {
    name: string;
    description: string;
    parameters: unknown;
}
/**
 * Plugin configuration.
 */
export interface TinyToolConfig {
    /** Tool names to keep fully visible (do not hide descriptions). */
    exemptTools?: string[];
    /** Tool name prefixes to keep fully visible (e.g. ['mnemon_']). */
    exemptPrefixes?: string[];
}
/**
 * The dsh-tiny-tool engine: snapshots the tool catalog and transforms every
 * system-prompt assembly to hide all tool descriptions behind minimum versions,
 * except for any explicitly exempted tools.
 */
export declare class TinyToolEngine {
    private readonly ctx;
    private readonly catalog;
    private readonly exemptTools;
    private readonly exemptPrefixes;
    constructor(ctx: Context, config?: TinyToolConfig);
    /**
     * Check if a tool name should be exempt from minification.
     */
    private isExempt;
    /**
     * Capture the current full tool catalog from the registry.
     * Runs on each assemble() call to ensure tools are registered before capture.
     */
    private snapshotCatalog;
    /**
     * Return the full schema for one tool, or undefined if unknown.
     * Used by the `tool_describe` bridge tool.
     * @param name - the tool name.
     * @returns the full schema, or undefined.
     */
    describe(name: string): ToolSchema | undefined;
    /**
     * Keyword-search the catalog. Returns matching tool names.
     * Used by the `tool_search` bridge tool.
     * @param query - the search query (case-insensitive substring match).
     * @returns matching tool names.
     */
    search(query: string): string[];
    /**
     * Transform one settled assembly: replace every tool schema with a minimum
     * version (preserves property names and types, strips descriptions), except
     * for any explicitly exempted tools which keep their full schema. The full
     * schemas remain in-memory for `tool_describe`.
     * @param assembly - the settled assembly from the waterfall chain.
     * @param _scope - the calling agent scope (unused).
     * @returns the transformed assembly.
     */
    assemble(assembly: PromptAssembly, _scope?: unknown): Promise<PromptAssembly>;
}
//# sourceMappingURL=engine.d.ts.map