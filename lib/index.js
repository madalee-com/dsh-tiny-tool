/**
 * dsh-tiny-tool: NO-OP stub for troubleshooting.
 *
 * All functional code has been disabled to isolate whether this plugin
 * interferes with other plugins (e.g. mnemon context injection).
 */
export const name = 'dsh-tiny-tool';
export const inject = [];
/** Settings namespace for plugin configuration. */
export const TINY_TOOL_SETTINGS_NS = 'tiny-tool-config';
/** Schema for the tiny-tool configuration (stub). */
export const TinyToolConfigSchema = { type: 'object', properties: {} };
/**
 * Apply the plugin: NO-OP stub.
 * @param ctx - the plugin context.
 * @param _config - plugin configuration (ignored).
 * @returns an empty object.
 */
export function apply(ctx, _config = {}) {
    // Intentionally empty — no tools registered, no hooks installed
    return {};
}
//# sourceMappingURL=index.js.map