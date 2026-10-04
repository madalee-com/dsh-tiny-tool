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
    /** Retained for backward compatibility. The proxy scheme now always sends
     * empty `{}` params on proxies, so this flag is effectively a no-op. */
    emptyParameters?: boolean;
}
/**
 * The dsh-tiny-tool engine: snapshots the tool catalog and transforms every
 * system-prompt assembly so each non-exempt, non-revealed tool appears as a
 * `use_<name>` proxy (truncated description, empty params `{}`). Calling a
 * proxy swaps in the real base tool with its full schema for the rest of the
 * session, where its full schema is re-exposed by the next assembly.
 */
export declare class TinyToolEngine {
    private readonly ctx;
    private readonly catalog;
    private readonly exemptTools;
    private readonly exemptPrefixes;
    /** Base tool names whose full schema has been revealed to the model this session. */
    private readonly revealed;
    /** One-time proxy disposer per base tool name, removed after its `use_<name>` is called. */
    private readonly proxies;
    constructor(ctx: Context, config?: TinyToolConfig);
    /**
     * Register a one-shot `use_<name>` proxy stub for every non-exempt tool.
     * Calling a proxy reveals the real base tool (full schema) for the rest of
     * the session and removes itself from the registry. Exempt tools keep their
     * full schemas untouched.
     */
    private registerProxies;
    /**
     * Check if a tool name should be exempt from the proxy scheme.
     */
    private isExempt;
    /**
     * Capture the current full tool catalog from the registry.
     * Runs on each assemble() call to ensure tools are registered before capture.
     */
    private snapshotCatalog;
    /**
     * Transform one settled assembly: every non-exempt, non-revealed tool is
     * shown as a `use_<name>` proxy (truncated description, empty params `{}`),
     * while revealed tools and exempt tools keep their full schema. A model that
     * calls `use_<name>` swaps in the real base tool for the rest of the
     * session, where its full schema is re-exposed by the next assembly.
     * @param assembly - the settled assembly from the waterfall chain.
     * @param _scope - the calling agent scope (unused).
     * @returns the transformed assembly.
     */
    assemble(assembly: PromptAssembly, _scope?: unknown, next?: (...args: unknown[]) => Promise<PromptAssembly>): Promise<PromptAssembly>;
}
//# sourceMappingURL=engine.d.ts.map