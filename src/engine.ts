/**
 * The dsh-tiny-tool engine: captures the full catalog and transforms assemblies
 * so each non-exempt, non-revealed tool is shown under its real name with a
 * trimmed description and empty `{}` parameters. Calling such a tool "unhides"
 * it for the rest of the session by registering its full definition scoped to
 * the calling agent; the host re-assembles on the retry, so the model then sees
 * the full parameters before the current turn proceeds.
 * @module dsh-tiny-tool/engine
 */

import { Context, symbols } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

export type ToolSchema = { name: string; description: string; parameters: Record<string, unknown> }

/** Render a tool result as plain text so the model can read it directly. */
const KEEP_THE_BASICS_TOOLS = [
  'bash',
  'todo_write',
  'ask_user_question',
  'edit',
  'write',
  'read',
  'present',
  'skill',
  'glob',
  'grep',
] as const

/** Render a tool result as plain text so the model can read it directly. */
function textRender(_args: unknown, value: unknown) {
  return [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }]
}

/** One captured catalog entry — the full schema retained for re-exposure in later assemblies. */
export interface CatalogEntry {
  name: string
  description: string
  parameters: unknown
}

/**
 * Plugin configuration.
 */
export interface TinyToolConfig {
  /** Tool names to keep fully visible (do not trim descriptions). */
  exemptTools?: string[]
  /** Tool name prefixes to keep fully visible (e.g. ['mnemon_']). */
  exemptPrefixes?: string[]
  /**
   * Automatically exclude a set of basic tools from the trim scheme, keeping them
   * fully visible under their real name with full parameters. Defaults to true.
   */
  keepTheBasics?: boolean
}

/**
 * Extract the first sentence from a description, including its terminating punctuation.
 */
function extractFirstSentence(description: string): string {
  const match = description.match(/^([^.*!?]*[.!?])/)
  return match?.[1] ?? ''
}

// Loose structural shapes so `exec.agent.ctx.tools` can be accessed without the
// (absent) `@deepseek-ai/dsh-agent` types being resolvable here.
type ToolsRegisterLike = { register?: (def: unknown) => () => void }
type AgentCtxLike = { tools?: ToolsRegisterLike }
type AgentLike = { ctx?: AgentCtxLike }
type ExecLike = { name: string; agent?: AgentLike }

/**
 * The dsh-tiny-tool engine.
 */
export class TinyToolEngine {
  private readonly ctx: Context
  private readonly catalog = new Map<string, CatalogEntry>()
  private readonly exemptTools = new Set<string>()
  private readonly exemptPrefixes = new Set<string>()
  /** Base tool names whose full schema has been revealed to the model this session. */
  private readonly revealed = new Set<string>()
  /** Original AgentLoop.buildRequest, saved for restoration if needed. */
  private originalBuildRequest?: (...args: [unknown, unknown, ToolSchema[], ...unknown[]]) => Promise<unknown>

  constructor(ctx: Context, config: TinyToolConfig = {}) {
    this.ctx = ctx
    if (config.exemptTools) {
      for (const name of config.exemptTools) this.exemptTools.add(name)
    }
    if (config.exemptPrefixes) {
      for (const prefix of config.exemptPrefixes) this.exemptPrefixes.add(prefix)
    }
    // Pre-populate revealed so these basic tools are never trimmed.
    const keepTheBasics = config.keepTheBasics !== false
    if (keepTheBasics) {
      for (const name of KEEP_THE_BASICS_TOOLS) this.revealed.add(name)
    }
    // Register the assemble hook explicitly.
    ctx.on('system-prompt/assemble', this.assemble.bind(this))
    // Reveal-on-execute: intercept calls to unrevealed, managed tools so the
    // tool's full definition can be registered in the calling agent's scope.
    ctx.on('tools/pre-execute', this.preExecute.bind(this))
    // Intercept buildRequest at the last point before tools reach the model.
    // The traceable proxy's set trap forwards to the raw AgentLoop instance,
    // so patching ctx.agentLoop.buildRequest overrides the internal call.
    this.patchBuildRequest(ctx)
  }

  /**
   * Monkey-patch `ReactLoopAgent.buildRequest` to trim tool schemas before they
   * reach the model. Agents are tracked in the `ctx.agents` registry; new agents
   * enter via `agents.enter(agent, owner)`, and existing agents are retrievable
   * via `agents.list()`. We patch each ReactLoopAgent's buildRequest when it is
   * entered, and also patch any already-live agents.
   *
   * The traceable proxy's set trap forwards property assignments to the raw
   * AgentRegistry instance, so patching `ctx.agents.enter` overrides the
   * internal creation path used by AgentLoop.initializeAgent.
   */
  private patchBuildRequest(ctx: Context): void {
    let patched = false

    const attempt = (): boolean => {
      try {
        const agents = ctx.get('agents') as { enter?: (...args: unknown[]) => unknown; list?: () => unknown[] } | undefined
        if (!agents) return false

        // Patch existing live agents first.
        if (Array.isArray(agents.list)) {
          for (const agent of agents.list()) {
            this.patchAgentBuildRequest(agent)
          }
        }

        // Intercept new agent creation to patch each ReactLoopAgent on entry.
        const originalEnter = agents.enter as ((agent: unknown, owner?: unknown) => unknown) | undefined
        if (originalEnter) {
          (agents as any).enter = (agent: unknown, owner?: unknown): unknown => {
            this.patchAgentBuildRequest(agent)
            return originalEnter.call(agents, agent, owner)
          }
          patched = true
          console.log('[tiny-tool] agents.enter patched for ReactLoopAgent.buildRequest')
        }

        if (!patched) {
          console.log('[tiny-tool] agents service available but enter not found; bailing')
        }
        return patched
      } catch (e) {
        console.error('[tiny-tool] patchBuildRequest attempt failed:', (e as Error).message)
        return false
      }
    }

    if (attempt()) return

    // Defer: agents service may not be available yet. Retry on lifecycle events.
    let scheduled = false
    const scheduleRetry = () => {
      if (patched) return
      console.log('[tiny-tool] retrying agent enter patch')
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        attempt()
      })
    }
    ctx.on('internal/plugin', (event: any) => scheduleRetry(), { global: true })
    ctx.on('internal/status', (event: any) => scheduleRetry(), { global: true })
    console.log('[tiny-tool] agents service not available at construction; deferring patch via lifecycle events')
  }

  /**
   * Patch a ReactLoopAgent's buildRequest method to trim tool schemas before
   * they reach the model. Guards against double-patching with a marker property.
   */
  private patchAgentBuildRequest(agent: unknown): void {
    if (!agent || typeof (agent as any).buildRequest !== 'function') return
    if ((agent as any).__tinyToolPatched) return
    const target = agent as { buildRequest: (...args: unknown[]) => Promise<unknown>; __tinyToolPatched?: boolean }
    const original = target.buildRequest.bind(target)
    target.__tinyToolPatched = true
    target.buildRequest = async (...args: unknown[]): Promise<unknown> => {
      const [config, preparedCall, tools] = args as [unknown, unknown, ToolSchema[]]
      const trimmedTools = this.trimTools(tools)
      return original(config, preparedCall, trimmedTools, ...args.slice(3))
    }
  }


  /**
   * Return a trimmed copy of the tool schemas: revealed/exempt tools keep their
   * full schema, everything else becomes a stub (first-sentence description +
   * empty parameters) so the model cannot see implementation details.
   */
  private trimTools(tools: ToolSchema[]): ToolSchema[] {
    this.snapshotCatalog()
    return tools.map(tool => {
      const entry = this.catalog.get(tool.name)
      if (!entry) {
        // Unknown tool: trim to first sentence to avoid leaking any metadata.
        return { name: tool.name, description: extractFirstSentence(tool.description ?? ''), parameters: {} }
      }
      if (this.revealed.has(entry.name) || this.isExempt(entry.name)) {
        return { name: entry.name, description: entry.description, parameters: entry.parameters as Record<string, unknown> }
      }
      return { name: entry.name, description: extractFirstSentence(entry.description), parameters: {} }
    })
  }

  /**
   * Reveal a base tool's full schema to exactly the calling agent by registering
   * its full definition in that agent's scope, then mark it revealed for the
   * rest of the session. Falls back to a plain reveal (mark + no register) when
   * the agent context or the base definition is unavailable.
   * @param name - the base tool name being revealed.
   * @param exec - the in-flight execution, providing the caller's agent scope.
   */
  private unhideAgentScoped(name: string, exec: ToolExecution): void {
    const execLike = exec as unknown as ExecLike
    const agentTools = execLike.agent?.ctx?.tools
    // `get` without a scope resolves the global base definition, which carries
    // the real `execute` + canonical `output`. Registering it in the caller's
    // scope shadows that base only for this agent.
    const base = agentTools ? this.ctx.tools.get(name) : undefined
    if (agentTools && base && agentTools.register) {
      agentTools.register(base)
    }
    this.revealed.add(name)
  }

  /**
   * `tools/pre-execute` waterfall: an unrevealed, non-exempt managed tool is
   * hidden-until-called. Tools with trivial (empty `{}`) parameters are
   * allowed through on first call and silently marked revealed — their full
   * description then appears only on the next assemble. Non-trivial tools
   * are registered in the calling agent's scope and denied once, triggering
   * a host re-assemble so the model retries with arguments. Everything else
   * passes through unchanged.
   * @param exec - the in-flight execution.
   * @param next - downstream decision in the waterfall.
   * @returns `deny` for unrevealed tools with non-trivial parameters; lazily revealed for empty-parameter tools (no deny); otherwise passthrough.
   */
  private async preExecute(exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> {
    const name = (exec as unknown as ExecLike).name
    if (!this.catalog.has(name)) return next()
    if (this.revealed.has(name) || this.isExempt(name)) return next()
    // Lazy-reveal: tools with trivial parameters are allowed through on first
    // call (no deny/re-assemble), but still marked revealed so their full
    // description appears on the next assemble.
    const entry = this.catalog.get(name)
    if (entry && this.isTrivialParameters(entry.parameters)) {
      this.revealed.add(name)
      return next()
    }
    this.unhideAgentScoped(name, exec)
    return { kind: 'deny', reason: `${name} is now enabled with its full parameters; call it again with arguments.` }
  }

  /**
   * Check if a tool name should be exempt from the trim scheme.
   */
  private isExempt(name: string): boolean {
    if (this.exemptTools.has(name)) return true
    for (const prefix of this.exemptPrefixes) {
      if (name.startsWith(prefix)) return true
    }
    return false
  }

  /**
    * Check whether a tool's schema is effectively empty — no arguments needed.
    * Handles both bare `{}` and JSON Schema variants like
    * `{type:'object', properties:{}}` where there are no required fields.
    */
  private isTrivialParameters(params: unknown): boolean {
    if (params == null) return true
    if (typeof params !== 'object' || Array.isArray(params)) return false
    const obj = params as Record<string, unknown>
    // Non-empty `required` array means mandatory args exist.
    if (Array.isArray(obj.required) && obj.required.length > 0) return false
    // Non-empty `properties` means named args exist.
    const props = obj.properties
    if (props && typeof props === 'object' && !Array.isArray(props)) {
      if (Object.keys(props as Record<string, unknown>).length > 0) return false
    }
    return true
  }

  /**
   * Capture the current full tool catalog from the registry.
   *
   * Tries multiple fallback strategies because `ctx.tools.schemas()` may throw
   * or return an empty array when accessed from the plugin's child fiber
   * context (harness cordis/dsh-* version drift).
   */
  private snapshotCatalog(): void {
    const toolsAny = this.ctx.tools as any
    const sources: Array<{ label: string; schemas: ToolSchema[] }> = []

    // Strategy 1: the documented public API.
    try {
      const schemas = toolsAny.schemas(undefined)
      if (Array.isArray(schemas)) sources.push({ label: 'schemas()', schemas })
    } catch (e) {
      console.error('[tiny-tool] ctx.tools.schemas() threw:', (e as Error).message)
    }

    // Strategy 2: definitions() returns the raw tool definition objects.
    if (sources.length === 0 && typeof toolsAny.definitions === 'function') {
      try {
        const defs = toolsAny.definitions(undefined)
        if (Array.isArray(defs)) {
          sources.push({
            label: 'definitions()',
            schemas: defs.map((d: any) => ({
              name: d.name ?? d.output?.name,
              description: d.description ?? d.output?.description,
              parameters: d.parameters ?? d.output?.parameters ?? {},
            })),
          })
        }
      } catch (e) {
        console.error('[tiny-tool] ctx.tools.definitions() threw:', (e as Error).message)
      }
    }

    // Strategy 3: view().visible is a Map<name, definition>.
    if (sources.length === 0 && typeof toolsAny.view === 'function') {
      try {
        const view = toolsAny.view(undefined)
        if (view && view.visible instanceof Map) {
          sources.push({
            label: 'view().visible',
            schemas: Array.from(view.visible.values()).map((d: any) => ({
              name: d.name ?? d.output?.name,
              description: d.description ?? d.output?.description,
              parameters: d.parameters ?? d.output?.parameters ?? {},
            })),
          })
        }
      } catch (e) {
        console.error('[tiny-tool] ctx.tools.view() threw:', (e as Error).message)
      }
    }

    let count = 0
    for (const source of sources) {
      for (const schema of source.schemas) {
        if (schema.name.startsWith('use_')) continue
        this.catalog.set(schema.name, {
          name: schema.name,
          description: schema.description ?? '',
          parameters: schema.parameters ?? {},
        })
        count++
      }
    }

    if (count === 0) {
      const methods = Object.getOwnPropertyNames(toolsAny).filter(n => typeof (toolsAny as any)[n] === 'function')
      console.error(
        `[tiny-tool] WARNING: catalog empty after all fallback strategies. ` +
        `ctx.tools available methods: ${methods.length ? methods.join(', ') : '(none found — ctx.tools may be inaccessible from this fiber)'}`
      )
    } else {
      console.error(`[tiny-tool] catalog populated via ${sources.map(s => s.label).join(' + ')}: ${count} tools`)
    }
  }

  /**
   * Transform one settled assembly: every non-exempt, non-revealed tool is shown
   * under its real name with a trimmed description and empty `{}` parameters,
   * while revealed tools and exempt tools keep their full schema. A model that
   * calls such a tool unhides it for the rest of the session (see
   * `preExecute`), where its full schema is re-exposed by the next assembly.
   * @param assembly - the settled assembly from the waterfall chain.
   * @param _scope - the calling agent scope (unused).
   * @returns the transformed assembly.
   */
  async assemble(assembly: PromptAssembly, _scope?: unknown, next?: (...args: unknown[]) => Promise<PromptAssembly>): Promise<PromptAssembly> {
    // Re-snapshot the catalog fresh on each assemble so we capture base tools
    // registered after apply(), before transforming in place.
    this.snapshotCatalog()
    if (this.catalog.size === 0) return assembly
    // Skip transformation for subagent contexts — they need full tool schemas.
    let agent: any
    try {
      agent = this.ctx.agents?.currentInitiator()
    } catch {
      agent = undefined
    }
    if (agent !== undefined) {
      const depth = ((agent.options as Record<string, unknown>)?.subagentDepth ?? (agent.session?.header as unknown as Record<string, unknown>)?.delegationDepth) ?? 0
      if ((depth as number) > 0) return assembly
    }
    // Populate the catalog from the assembly's own tools too, so we can trim any
    // tool not registered through ctx.tools.register (e.g., remote service
    // methods like read/write).
    const tools = assembly.tools ?? []
    for (const tool of tools) {
      if (tool.name.startsWith('use_')) continue
      if (!this.catalog.has(tool.name)) {
        this.catalog.set(tool.name, {
          name: tool.name,
          description: (tool.description ?? '') as string,
          parameters: (tool.parameters ?? {}) as ToolSchema['parameters'],
        })
      }
    }
    // Present base tools under their real name: revealed/exempt keep their full
    // schema; every other managed tool is trimmed to its first sentence with
    // empty `{}` parameters.
    const stubbedTools: ToolSchema[] = tools
      .filter(tool => !tool.name.startsWith('use_'))
      .map(tool => {
        const entry = this.catalog.get(tool.name)
        if (entry === undefined) {
          const desc = (tool.description ?? '') as string
          return { name: tool.name, description: extractFirstSentence(desc), parameters: {} }
        }
        // Revealed and exempt tools keep their full schema.
        if (this.revealed.has(entry.name) || this.isExempt(entry.name)) {
          return { name: entry.name, description: entry.description, parameters: entry.parameters as ToolSchema['parameters'] }
        }
        // Otherwise trim to the real name, first sentence, and empty params.
        return { name: entry.name, description: extractFirstSentence(entry.description), parameters: {} }
      })
    // Also include any catalog tools not present in the assembly (edge case).
    for (const entry of this.catalog.values()) {
      if (tools.some(t => t.name === entry.name)) continue
      if (this.revealed.has(entry.name) || this.isExempt(entry.name)) {
        stubbedTools.push({ name: entry.name, description: entry.description, parameters: entry.parameters as ToolSchema['parameters'] })
      } else {
        stubbedTools.push({ name: entry.name, description: extractFirstSentence(entry.description), parameters: {} })
      }
    }
    // Call next() to allow downstream listeners (e.g., mnemon) to run
    const result = next ? await next(assembly, _scope) : assembly
    return { ...result, tools: stubbedTools }
  }
}
