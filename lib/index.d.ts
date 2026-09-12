/**
 * dsh-tiny-tool: NO-OP stub for troubleshooting.
 *
 * All functional code has been disabled to isolate whether this plugin
 * interferes with other plugins (e.g. mnemon context injection).
 */
import { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-tiny-tool";
export declare const inject: readonly [];
/** Settings namespace for plugin configuration. */
export declare const TINY_TOOL_SETTINGS_NS = "tiny-tool-config";
/** Schema for the tiny-tool configuration (stub). */
export declare const TinyToolConfigSchema: {
    type: string;
    properties: {};
};
/**
 * Apply the plugin: NO-OP stub.
 * @param ctx - the plugin context.
 * @param _config - plugin configuration (ignored).
 * @returns an empty object.
 */
export declare function apply(ctx: Context, _config?: Record<string, unknown>): Record<string, never>;
//# sourceMappingURL=index.d.ts.map