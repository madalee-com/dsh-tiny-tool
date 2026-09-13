/**
 * Register the bridge tools that expose the deferred catalog on demand.
 * @module dsh-tiny-tool/bridge
 */
import { Context } from '@deepseek-ai/cordis';
import type { TinyToolEngine } from './engine.js';
/** The bridge tool names. */
export declare const BRIDGE_NAMES: readonly ["tool_search", "tool_describe"];
/**
 * Register the bridge tools. Each returns a JSON string so
 * the model can parse results directly; failures return a JSON `{ error }`
 * instead of throwing.
 * @param ctx - the plugin context.
 * @param engine - engine-backed search/describe services.
 * @returns the combined disposer for all registrations.
 */
export declare function registerBridgeTools(ctx: Context, engine: TinyToolEngine): () => void;
