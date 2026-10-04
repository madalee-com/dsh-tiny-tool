import { TinyToolEngine } from '../lib/engine.js'

// Focused behavioral check for the proxy swap-in outcome. Mirrors the host
// runtime path: engine.assemble() registers the use_<name> proxies, then we
// invoke the registered proxy directly and assert it surfaces as an error.

const baseTool = {
  name: 'read',
  description: 'Read a UTF-8 text file.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
}

// The registry mock: schemas() exposes the base tool so registerProxies sees
// it, and register() captures each emitted proxy stub for inspection.
const registered = []
const ctx = {
  tools: {
    schemas: () => [baseTool],
    register: (def) => {
      registered.push(def)
      return () => {}
    },
  },
  agents: { currentInitiator: () => undefined },
  on: () => {},
}

const engine = new TinyToolEngine(ctx, {})
await engine.assemble(
  { tools: [baseTool] },
  undefined,
  (assembly) => Promise.resolve(assembly),
)

const proxy = registered.find((t) => t.name === 'use_read')
if (!proxy) throw new Error('FAIL — use_read proxy was not registered')

const expected = 'use_read removed, use read instead'
let threw = false
try {
  await proxy.execute({}, {})
} catch (error) {
  threw = true
  if (error.message !== expected) {
    throw new Error(`FAIL — message "${error.message}", expected "${expected}"`)
  }
  console.log('OK — proxy threw:', error.message)
}

if (!threw) throw new Error('FAIL — proxy did not throw')

console.log('\nRESULT: PASS — use_read swaps in read and throws the new message')
process.exit(0)
