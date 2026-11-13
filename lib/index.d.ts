/**
 * dsh-tiny-tool: Hide all tool/MCP descriptions from the system prompt.
 *
 * When loaded, this plugin replaces every tool schema in the model-visible
 * system prompt with a minimal stub (name only). The full schemas are kept
 * in-memory and re-exposed to the model once its `use_<name>` proxy is called.
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
export declare const TinyToolConfigSchema: z<Schemastery.ObjectS<NoInfer<{
    exemptTools: z<string[], string[], "plain">;
    exemptPrefixes: z<string[], string[], "plain">;
    emptyParameters: z<boolean, boolean, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    exemptTools: z<string[], string[], "plain">;
    exemptPrefixes: z<string[], string[], "plain">;
    emptyParameters: z<boolean, boolean, "defined">;
}>>, "plain">;
/**
 * Apply the plugin: snapshot the full tool catalog, wrap ToolsService so managed
 * tools project trimmed schemas to the model, hook tools/pre-execute for
 * reveal-on-call, and register settings for UI config.
 * @param ctx - the plugin context.
 * @param config - plugin configuration (see TinyToolConfig).
 * @returns the engine instance.
 */
export declare function apply(ctx: Context, config?: TinyToolConfig): TinyToolEngine;
//# sourceMappingURL=index.d.ts.map