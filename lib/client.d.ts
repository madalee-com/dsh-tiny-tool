/**
 * dsh-tiny-tool client UI: Settings panel for configuring exemptions.
 * @module dsh-tiny-tool/client
 */
import type { Context } from '@deepseek-ai/cordis';
import { TinyToolConfigSchema } from './index.js';
/**
 * Register a bridge tool that exposes the settings namespace for UI consumption.
 * The UI can read/write this namespace to configure exemptions dynamically.
 */
export declare function apply(ctx: Context): void;
/** Configuration type for the UI. */
export interface TinyToolConfig {
    exemptTools?: string[];
    exemptPrefixes?: string[];
}
export { TinyToolConfigSchema };
//# sourceMappingURL=client.d.ts.map