import { TinyToolEngine } from '../lib/engine.js'

// Focused behavioral check for the reveal-on-execute design. Mirrors the host
// runtime path: engine.assemble() presents base tools under their real name
// with a trimmed description and empty `{}` parameters, then we simulate a model
// call through the registered `tools/pre-execute` handler and assert it unhides
// the tool (agent-scoped) and denies once so the host re-assembles.

const baseTool = {
  name: 'read',
  description: 'Read a UTF-8 text file.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
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
assert(presented.name === 'read', `tool should keep its real name, got ${presented.name}`)
assert(presented.description === 'Read a UTF-8 text file.', `description should be trimmed, got ${JSON.stringify(presented.description)}`)
assert(JSON.stringify(presented.parameters) === '{}', `unrevealed parameters should be {}, got ${JSON.stringify(presented.parameters)}`)
console.log('OK — base tool presented under real name with trimmed description and empty params')

// Simulate a model call to the unrevealed tool via the pre-execute hook.
const allow = () => Promise.resolve({ kind: 'allow' })
const decision = await listeners['tools/pre-execute'](
  { name: 'read', agent: { ctx: { tools: agentToolsMock } } },
  allow,
)

assert(decision.kind === 'deny', `first call should deny to force a re-assemble, got ${decision.kind}`)
assert(agentRegistered.length === 1, `base tool should be registered once for the calling agent`)
const unhidden = agentRegistered[0]
assert(unhidden.name === 'read', `registered definition should keep the real name, got ${unhidden.name}`)
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
assert(revealed.name === 'read', 'revealed tool should keep its real name')
assert(revealed.description === 'Read a UTF-8 text file.', 'revealed tool should show the full description')
assert(JSON.stringify(revealed.parameters) === JSON.stringify(baseTool.parameters), 'revealed tool should show the full parameters')
console.log('OK — re-assembled tool shows full schema on the retry')

// A second call to the now-revealed tool passes through without denying.
const decision2 = await listeners['tools/pre-execute'](
  { name: 'read', agent: { ctx: { tools: agentToolsMock } } },
  allow,
)
assert(decision2.kind === 'allow', `revealed tool should pass through, got ${decision2.kind}`)
console.log('OK — revealed tool passes pre-execute')

console.log(`\nRESULT: PASS — ${assertions} assertions held (real-name trim + agent-scoped reveal-on-execute)`)
process.exit(0)
