// Focused behavioral check for dsh-tiny-tool's "remove proxy + re-add original"
// swap-in. Drives the engine against an in-memory tool registry (mirroring the
// host runtime path: register / get / schemas / guard) without a live session.

import { TinyToolEngine } from '../lib/engine.js'

/** Build a minimal cordis-like `ctx.tools` that actually tracks registrations. */
function makeTools() {
  const reg = new Map()
  const guards = []
  return {
    schemas: (_scope) => [...reg.values()],
    get: (name) => reg.get(name),
    register: (def) => {
      reg.set(def.name, def)
      return () => reg.delete(def.name) // disposer removes the registration
    },
    guard: (fn) => guards.push(fn),
    _guards: guards,
    _reg: reg,
  }
}

const readSchema = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
const webSearchSchema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
const exemptSchema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }

/** Seed a registry the engine will snapshot, then construct the engine. */
function boot(extra) {
  const tools = makeTools()
  tools._reg.set('read', { name: 'read', description: 'Read a UTF-8 text file.', parameters: readSchema })
  tools._reg.set('web_search', { name: 'web_search', description: 'Search the web for current information.', parameters: webSearchSchema })
  tools._reg.set('dtt_exempt', { name: 'dtt_exempt', description: 'Exempted tool.', parameters: exemptSchema })
  if (extra) extra(tools)
  const ctx = { tools, agents: { currentInitiator: () => undefined }, on: () => {} }
  return { engine: new TinyToolEngine(ctx, { exemptTools: ['dtt_exempt'] }), tools }
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
let ok = true
const check = (label, cond) => { console.log((cond ? 'OK:  ' : 'FAIL: ') + label); if (!cond) ok = false }

// --- Scenario A: no-args call must deny with a hint AND swap in the full schema ---
{
  const { engine, tools } = boot()
  const next = (a) => a
  const initial = await engine.assemble({ tools: tools._reg.size ? [...tools._reg.values()] : [], undefined }, undefined, next)
  const web0 = initial.tools.find((t) => t.name === 'web_search')
  check('A: initial web_search shown as empty stub {}', eq(web0.parameters, {}))

  // Simulate the model calling the stub with no arguments.
  const hint = tools._guards[0]({ name: 'web_search', arguments: {} })
  check('A: first no-args call returns a review hint', typeof hint === 'string' && hint.includes('web_search'))

  // After the swap, the full schema must be visible in the next assembly.
  const swapped = await engine.assemble({ tools: [...tools._reg.values()] }, undefined, next)
  const web1 = swapped.tools.find((t) => t.name === 'web_search')
  check('A: after call web_search shows FULL schema', eq(web1.parameters, webSearchSchema))

  // Exempt tool must always stay fully visible.
  const ex = swapped.tools.find((t) => t.name === 'dtt_exempt')
  check('A: dtt_exempt keeps full schema', eq(ex.parameters, exemptSchema))
}

// --- Scenario B: args-passed call allows (no hint) but still swaps in ---
{
  const { engine, tools } = boot()
  const next = (a) => a
  tools._reg.set('web_search', { name: 'web_search', description: 'Search the web.', parameters: webSearchSchema })
  const allow = tools._guards[0]({ name: 'web_search', arguments: { query: 'x' } })
  check('B: args-passed call returns undefined (allow)', allow === undefined)
  const swapped = await engine.assemble({ tools: [...tools._reg.values()] }, undefined, next)
  const web1 = swapped.tools.find((t) => t.name === 'web_search')
  check('B: after args-call web_search shows FULL schema', eq(web1.parameters, webSearchSchema))
}

console.log(ok ? '\nRESULT: PASS' : '\nRESULT: FAIL')
process.exit(ok ? 0 : 1)
