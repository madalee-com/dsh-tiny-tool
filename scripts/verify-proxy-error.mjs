import { TinyToolEngine } from '../lib/engine.js'

// Focused behavioral check for the reveal-on-execute design. Mirrors the host
// runtime path: engine.assemble() presents base tools under their real name
// with a trimmed description and empty `{}` parameters, then we simulate a model
// call through the registered `tools/pre-execute` handler and assert it unhides
// the tool (agent-scoped) and denies once so the host re-assembles.

const baseTool = {
  name: 'fetch_url',
  description: 'Fetch the content of a specific HTTP(S) URL.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string' } },
    required: ['url'],
  },
}

// The agent-scoped registry: captures full definitions registered for the
// calling agent during reveal-on-execute.
const agentRegistered = []
const agentToolsMock = { register: (def) => { agentRegistered.push(def); return () => {} } }

// The global registry mock: schemas() exposes the base tool to the catalog;
// get() resolves the base definition (real execute + canonical output).
const ctx = {
  tools: {
    schemas: () => [baseTool],
    get: (name) => (name === baseTool.name ? baseTool : undefined),
    register: () => () => {},
  },
  agents: { currentInitiator: () => undefined }, // top-level chat agent
  on: (event, handler) => { listeners[event] = handler },
}

const listeners = {}
let assertions = 0

function assert(cond, msg) {
  assertions += 1
  if (!cond) throw new Error('FAIL — ' + msg)
}

const engine = new TinyToolEngine(ctx, {})

// Assemble once: base tool should be presented under its real name with a
// trimmed first-sentence description and empty `{}` parameters.
const a1 = await engine.assemble(
  { tools: [baseTool] },
  undefined,
  (assembly) => Promise.resolve(assembly),
)

const presented = a1.tools[0]
assert(presented.name === 'fetch_url', `tool should keep its real name, got ${presented.name}`)
assert(presented.description === 'Fetch the content of a specific HTTP(S) URL.', `description should be trimmed, got ${JSON.stringify(presented.description)}`)
assert(JSON.stringify(presented.parameters) === '{}', `unrevealed parameters should be {}, got ${JSON.stringify(presented.parameters)}`)
console.log('OK — base tool presented under real name with trimmed description and empty params')

// Simulate a model call to the unrevealed tool via the pre-execute hook.
const allow = () => Promise.resolve({ kind: 'allow' })
const decision = await listeners['tools/pre-execute'](
  { name: 'fetch_url', agent: { ctx: { tools: agentToolsMock } } },
  allow,
)

assert(decision.kind === 'deny', `first call should deny to force a re-assemble, got ${decision.kind}`)
assert(agentRegistered.length === 1, `base tool should be registered once for the calling agent`)
const unhidden = agentRegistered[0]
assert(unhidden.name === 'fetch_url', `registered definition should keep the real name, got ${unhidden.name}`)
assert(JSON.stringify(unhidden.parameters) === JSON.stringify(baseTool.parameters), `unhidden definition should carry the full parameters`)
console.log('OK — call unhides the tool (agent-scoped) and denies once')

// After the deny, the host re-assembles: the revealed tool now keeps its full
// schema (real description + full parameters).
const a2 = await engine.assemble(
  { tools: [baseTool] },
  undefined,
  (assembly) => Promise.resolve(assembly),
)

const revealed = a2.tools[0]
assert(revealed.name === 'fetch_url', 'revealed tool should keep its real name')
assert(revealed.description === 'Fetch the content of a specific HTTP(S) URL.', 'revealed tool should show the full description')
assert(JSON.stringify(revealed.parameters) === JSON.stringify(baseTool.parameters), 'revealed tool should show the full parameters')
console.log('OK — re-assembled tool shows full schema on the retry')

// A second call to the now-revealed tool passes through without denying.
const decision2 = await listeners['tools/pre-execute'](
  { name: 'fetch_url', agent: { ctx: { tools: agentToolsMock } } },
  allow,
)
assert(decision2.kind === 'allow', `revealed tool should pass through, got ${decision2.kind}`)
console.log('OK — revealed tool passes pre-execute')

console.log('\nRESULT: PASS — 11 assertions held (real-name trim + agent-scoped reveal-on-execute)')

// Additional check: keepTheBasics=true pre-populates revealed so basic tools
// bypass the trim scheme — pre-execute returns 'allow' without forcing a re-assemble.
const ctx3 = {
  tools: {
    schemas: () => [baseTool],
    get: (n) => n === baseTool.name ? baseTool : undefined,
    register: () => () => {},
  },
  agents: { currentInitiator: () => undefined },
  on: (e, h) => { listeners[e] = h },
}

const engine3 = new TinyToolEngine(ctx3, { keepTheBasics: true })

// 'read' should be in revealed from the start — pre-execute returns 'allow'.
const allowRead = () => Promise.resolve({ kind: 'allow' })
const decisionRead = await listeners['tools/pre-execute'](
  { name: 'read', agent: { ctx: { tools: agentToolsMock } } },
  allowRead,
)
assert(decisionRead.kind === 'allow', `"read" with keepTheBasics=true should pass pre-execute immediately (no deny/re-assemble), got ${decisionRead.kind}`)
console.log('OK — keepTheBasics pre-populates revealed; basic tools bypass the trim scheme')

// Lazy-reveal: tools with trivial {} parameters should be allowed through on
// first call (no deny), silently added to revealed, full desc appears next assemble.
const ctx4 = {
  tools: {
    schemas: () => [baseTool, { name: 'noop_tool', description: 'A no-op tool.', parameters: {} }],
    get: (n) => n === baseTool.name ? baseTool : undefined,
    register: () => () => {},
  },
  agents: { currentInitiator: () => undefined },
  on: (e, h) => { listeners[e] = (...a) => h(...a) },
}

const engine4 = new TinyToolEngine(ctx4)
// assemble populates the catalog; then preExecute sees it.
await engine4.assemble({ tools: [baseTool] }, undefined, () => Promise.resolve({ tools: [baseTool] }))

const decisionNoop = await listeners['tools/pre-execute'](
  { name: 'noop_tool', agent: { ctx: { tools: agentToolsMock } } },
  allowRead,
)
assert(decisionNoop.kind === 'allow', `noop_tool (empty params) should be allowed through on first call, got ${decisionNoop.kind}`)
assert(engine4.revealed.has('noop_tool'), 'noop_tool should be silently added to revealed after lazy-reveal')

// A second engine with non-trivial params should still deny.
const ctx5 = {
  tools: {
    schemas: () => [baseTool, { name: 'named_tool', description: 'A tool with args.', parameters: { type: 'object', properties: { x: { type: 'string' } } } }],
    get: (n) => n === baseTool.name ? baseTool : undefined,
    register: () => () => {},
  },
  agents: { currentInitiator: () => undefined },
  on: (e, h) => { listeners[e] = (...a) => h(...a) },
}

const engine5 = new TinyToolEngine(ctx5)
await engine5.assemble({ tools: [baseTool] }, undefined, () => Promise.resolve({ tools: [baseTool] }))

const decisionNamed = await listeners['tools/pre-execute'](
  { name: 'named_tool', agent: { ctx: { tools: agentToolsMock } } },
  allowRead,
)
assert(decisionNamed.kind === 'deny', `named_tool (non-empty params) should be denied on first call, got ${decisionNamed.kind}`)
assert(engine5.revealed.has('named_tool'), 'named_tool should still be added to revealed even on deny')

console.log('OK — lazy-reveal: trivial {} tools pass through; non-trivial tools still deny-on-first-call')

process.exit(0)
