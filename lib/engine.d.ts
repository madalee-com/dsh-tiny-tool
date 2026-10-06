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
 * registers proxy stubs under the original `<name>` (no `use_` prefix), and
 * transforms every system-prompt assembly so each non-exempt, non-revealed
 * tool appears as a proxy stub (truncated description, empty params `{}`).
 * Calling a proxy triggers a three-rule swap-in: forward (no original params),
 * error+swap (original has params but none passed), or forward+swap (params passed).
 */
export declare class TinyToolEngine {
    private readonly ctx;
    private readonly catalog;
    private readonly exemptTools;
    private readonly exemptPrefixes;
    /** Base tool names whose full schema has been revealed to the model this session. */
    private readonly revealed;
    /** One-time proxy disposer per renamed handle, removed after its proxy is called. */
    private readonly proxies;
    /** Original name → renamed handle mapping (e.g. "gitea_branches" → "tt_gitea_branches"). */
    private readonly renamedTo;
    /** Names of proxy stubs we've already registered this session (prevents re-registration on subsequent assemble cycles). */
    private readonly registeredProxyNames;
    constructor(ctx: Context, config?: TinyToolConfig);
    /**
     * Register a one-shot proxy stub for every non-exempt tool.
     * Proxies are registered under the original `<name>` (no `use_` prefix).
     * Internally, they point to the renamed handle (`tt_<name>`) in the catalog.
     * Calling a proxy triggers the three-rule swap-in: forward, error+swap, or forward+swap.
     */
    private registerProxies;
    /**
     * Check if a tool name should be exempt from the proxy scheme.
     */
    private isExempt;
    /**
     * Capture the current full tool catalog from the registry.
     * Renames every base tool to `tt_<name>` internally to avoid name collisions
     * when proxies are registered under the original `<name>` (no `use_` prefix).
     * Runs on each assemble() call to ensure tools are registered before capture.
     */
    private snapshotCatalog;
    /**
     * Transform one settled assembly: every non-exempt, non-revealed tool is
     * shown as a proxy stub (truncated description, empty params `{}`),
     * while revealed tools and exempt tools keep their full schema. A model that
     * calls a proxy triggers the three-rule swap-in logic via the registered handler.
     * @param assembly - the settled assembly from the waterfall chain.
     * @param _scope - the calling agent scope (unused).
     * @returns the transformed assembly.
     */
    assemble(assembly: PromptAssembly, _scope?: unknown, next?: (...args: unknown[]) => Promise<PromptAssembly>): Promise<PromptAssembly>;
}
//# sourceMappingURL=engine.d.ts.map