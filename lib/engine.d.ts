/**
 * The engine that captures the full catalog and transforms assemblies.
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
    /** Tool names to keep fully visible (do not hide descriptions). */
    exemptTools?: string[];
    /** Tool name prefixes to keep fully visible (e.g. ['mnemon_']). */
    exemptPrefixes?: string[];
    /** Retained for backward compatibility. The three-rule proxy scheme now handles
     * parameter routing at proxy-call time (forward, error, or swap-in).
     * This flag is effectively a no-op but kept to avoid breaking existing configs. */
    emptyParameters?: boolean;
}
/**
 * The dsh-tiny-tool engine: captures the full tool catalog, transforms assemblies
 * to show proxy stubs (truncated desc, empty params), and uses a monotonic guard
 * to remove original tools from view and re-register them with full parameters
 * after the first call — so subsequent calls see the correct schema in context.
 */
export declare class TinyToolEngine {
    private readonly ctx;
    private readonly catalog;
    private readonly exemptTools;
    private readonly exemptPrefixes;
    /** Disposers for tools we've replaced — used to restore on session teardown. */
    private readonly disposers;
    constructor(ctx: Context, config?: TinyToolConfig);
    /**
     * Check if a tool name should be exempt from the proxy scheme.
     */
    private isExempt;
    /**
     * Capture the current full tool catalog from the registry.
     * Renames every base tool to `tt_<name>` internally to avoid name collisions
     * when proxies are registered under the original `<name>` (no `use_` prefix).
     */
    private snapshotCatalog;
    /**
     * Transform one settled assembly: every non-exempt, non-replaced tool is
     * shown as a proxy stub (truncated description, empty params `{}`),
     * while replaced tools (full schema registered) and exempt tools keep
     * their complete schema.
     * @param assembly - the settled assembly from the waterfall chain.
     * @param _scope - the calling agent scope (unused).
     * @returns the transformed assembly.
     */
    assemble(assembly: PromptAssembly, _scope?: unknown, next?: (...args: unknown[]) => Promise<PromptAssembly>): Promise<PromptAssembly>;
}
//# sourceMappingURL=engine.d.ts.map