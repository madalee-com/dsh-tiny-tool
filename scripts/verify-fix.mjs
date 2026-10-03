import { TinyToolEngine } from '../lib/engine.js'

const readSchema = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
const webFetch = { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
const noArg = { type: 'object', properties: {} }

const assembly = { tools: [
  { name: 'read', description: 'Read a UTF-8 text file.', parameters: readSchema },
  { name: 'web_fetch', description: 'Fetch the content of an HTTP URL.', parameters: webFetch },
  { name: 'exit_plan_mode', description: 'Plan.', parameters: noArg },
] }
const next = (a) => a
const ctx = { tools: { schemas: () => [] }, agents: { currentInitiator: () => undefined }, on: () => {} }
const engine = new TinyToolEngine(ctx, { emptyParameters: true })
const out = await engine.assemble(assembly, undefined, next)
console.log('output tools:', JSON.stringify(out.tools.map(t => ({ name: t.name, params: JSON.stringify(t.parameters) }))))
let ok = true
for (const t of out.tools) {
  const hasRequired = !!(t.parameters && t.parameters.required && t.parameters.required.length > 0)
  if (hasRequired && JSON.stringify(t.parameters) === '{}') {
    console.error('FAIL:', t.name, 'required-arg tool collapsed to {} -> non-invokable'); ok = false
  } else {
    console.log('OK:', t.name, '->', JSON.stringify(t.parameters))
  }
}
console.log(ok ? '\nRESULT: PASS — no required-arg tool collapsed to bare {}' : '\nRESULT: FAIL')
process.exit(ok ? 0 : 1)
