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
    /** Tool names to keep fully visible (do not stub them). */
    exemptTools?: string[];
    /** Tool name prefixes to keep fully visible (e.g. ['mnemon_']). */
    exemptPrefixes?: string[];
    /** Retained for backward compatibility. The proxy scheme now manages
     * parameter routing at proxy-call time; this flag is a no-op but kept so
     * existing configs keep loading without breaking. */
    emptyParameters?: boolean;
}
/**
 * The dsh-tiny-tool engine: captures the full tool catalog, presents every
 * non-exempt tool as a stub (truncated description, empty params `{}`), and on
 * the first call swaps the stub for the tool's real full schema — removing our
 * proxy and re-adding the original so subsequent assemblies show correct params.
 */
export declare class TinyToolEngine {
    private readonly ctx;
    private readonly catalog;
    private readonly exemptTools;
    private readonly exemptPrefixes;
    /** Captured original full-schema definitions, keyed by model-facing name. */
    private readonly originals;
    /** One-shot empty-proxy disposer per stubbed tool, removed once swapped in. */
    private readonly proxies;
    /** Model-facing names whose real schema has been swapped into this session. */
    private readonly revealed;
    constructor(ctx: Context, config?: TinyToolConfig);
    /** Check if a tool name should be exempt from the proxy scheme. */
    private isExempt;
    /**
     * Capture the full tool catalog from the registry. Runs once at construction,
     * before any proxy stub is registered, so entries keep their real parameters.
     */
    private snapshotCatalog;
    /**
     * Absorb tools registered after construction (e.g. late-registered MCP tools),
     * stubbing each so it participates in the proxy scheme. Existing entries keep
     * their pristine full schema and are never overwritten here.
     */
    private absorbNewTools;
    /**
     * Register one empty proxy stub per non-exempt, parametered tool. Each stub
     * occupies the tool's name so the model sees `{}` params; the original
     * full-schema definition is captured for re-add on first call.
     */
    private registerProxies;
    /**
     * Transform one settled assembly: non-exempt, unrevealed tools render as stubs
     * (truncated description, empty params `{}`); revealed tools (schema swapped
     * in via the guard) render with their complete schema; exempt tools keep full.
     */
    assemble(assembly: PromptAssembly, _scope?: unknown, next?: (...args: unknown[]) => Promise<PromptAssembly>): Promise<PromptAssembly>;
}
//# sourceMappingURL=engine.d.ts.map