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
 * The dsh-tiny-tool engine: renames every base tool to `tt_<name>` internally,
 * registers a monotonic guard that intercepts calls and applies the three-rule
 * swap-in logic (forward, error+swap, or forward+swap).
 * Transforms system-prompt assemblies so each non-exempt, non-revealed
 * tool appears as a proxy stub (truncated description, empty params `{}`).
 */
export declare class TinyToolEngine {
    private readonly ctx;
    private readonly catalog;
    private readonly exemptTools;
    private readonly exemptPrefixes;
    /** Base tool names whose full schema has been revealed to the model this session. */
    private readonly revealed;
    /** Original name → renamed handle mapping (e.g. "gitea_branches" → "tt_gitea_branches"). */
    private readonly renamedTo;
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
     * Transform one settled assembly: every non-exempt, non-revealed tool is
     * shown as a proxy stub (truncated description, empty params `{}`),
     * while revealed tools and exempt tools keep their full schema. A model that
     * calls a proxy triggers the three-rule swap-in logic via the monotonic guard.
     * @param assembly - the settled assembly from the waterfall chain.
     * @param _scope - the calling agent scope (unused).
     * @returns the transformed assembly.
     */
    assemble(assembly: PromptAssembly, _scope?: unknown, next?: (...args: unknown[]) => Promise<PromptAssembly>): Promise<PromptAssembly>;
}
//# sourceMappingURL=engine.d.ts.map