/**
 * dsh-tiny-tool: Hide all tool/MCP descriptions from the system prompt.
 *
 * When loaded, this plugin renames every base tool to `tt_<name>` internally,
 * then registers a proxy stub under the original `<name>` (no `use_` prefix).
 * Full schemas are kept in-memory and re-exposed to the model when its proxy
 * is called. Calling a proxy triggers a three-rule swap-in: forward (no params
 * on original), error+swap (original has params but none passed), or
 * forward+swap (params passed to original).
 *
 * Configurable via settings namespace `tiny-tool-config`.
 *
 * @module dsh-tiny-tool
 */
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { TinyToolEngine, type TinyToolConfig } from './engine.js';
export declare const name = "dsh-tiny-tool";
export declare const inject: string[];
/** Settings namespace for plugin configuration. */
export declare const TINY_TOOL_SETTINGS_NS = "tiny-tool-config";
/** Schema for the tiny-tool configuration. */
export declare const TinyToolConfigSchema: z<Schemastery.ObjectS<{
    exemptTools: z<string[], string[]>;
    exemptPrefixes: z<string[], string[]>;
    /** Retained for backward compatibility. The three-rule proxy scheme now handles
     * parameter routing at proxy-call time (forward, error, or swap-in).
     * This flag is effectively a no-op but kept to avoid breaking existing configs. */
    emptyParameters: z<boolean, boolean>;
}>, Schemastery.ObjectT<{
    exemptTools: z<string[], string[]>;
    exemptPrefixes: z<string[], string[]>;
    /** Retained for backward compatibility. The three-rule proxy scheme now handles
     * parameter routing at proxy-call time (forward, error, or swap-in).
     * This flag is effectively a no-op but kept to avoid breaking existing configs. */
    emptyParameters: z<boolean, boolean>;
}>>;
/**
 * Apply the plugin: snapshot the full catalog, register bridge tools, hook
 * the system-prompt/assemble waterfall, and register settings for UI config.
 * @param ctx - the plugin context.
 * @param config - plugin configuration (see TinyToolConfig).
 * @returns the engine instance.
 */
export declare function apply(ctx: Context, config?: TinyToolConfig): TinyToolEngine;
//# sourceMappingURL=index.d.ts.map