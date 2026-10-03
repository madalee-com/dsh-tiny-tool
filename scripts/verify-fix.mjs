import { TinyToolEngine } from '../lib/engine.js'

// Minimal behavioral check: non-exempt tools must collapse to {} when
// emptyParameters is on; exempt tools keep their full schema. This mirrors the
// host runtime path (engine.assemble) without needing a live session.

const readSchema = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
const exemptTool = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }

const assembly = { tools: [
  { name: 'read', description: 'Read a UTF-8 text file.', parameters: readSchema },
  { name: 'dtt_exempt', description: 'Exempted tool.', parameters: exemptTool },
] }
const next = (a) => a
const ctx = { tools: { schemas: () => [] }, agents: { currentInitiator: () => undefined }, on: () => {} }
const engine = new TinyToolEngine(ctx, { emptyParameters: true })

const out = await engine.assemble(assembly, undefined, next)
console.log('output tools:', JSON.stringify(out.tools.map(t => ({ name: t.name, params: JSON.stringify(t.parameters) }))))

let ok = true
for (const t of out.tools) {
  if (t.name === 'dtt_exempt') {
    const full = JSON.stringify(t.parameters) === JSON.stringify(exemptTool)
    console.log(full ? 'OK:' : 'FAIL:', t.name, '-> should keep full schema')
    if (!full) ok = false
  } else {
    const collapsed = JSON.stringify(t.parameters) === '{}'
    console.log(collapsed ? 'OK:' : 'FAIL:', t.name, '-> should collapse to {}')
    if (!collapsed) ok = false
  }
}
console.log(ok ? '\nRESULT: PASS — non-exempt {}-collapsed, exempt kept full' : '\nRESULT: FAIL')
process.exit(ok ? 0 : 1)
