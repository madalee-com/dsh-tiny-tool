// Emulate the DSH client runtime loading contract for a prebuilt client bundle:
//   1. import the entry -> top-level window.__ModuleLoader__?.load(...) runs
//   2. capture the { id, factory } passed to load()
//   3. invoke factory(require) exactly as dsh does at activation; read its return
import assert from 'node:assert'

const captured = new Map()
globalThis.window = { __ModuleLoader__: { load({ id, factory }) { captured.set(id, factory) } } }

function requireShim(id) {
  if (id === 'react') return import('react').then(m => m.default ?? m)
  throw new Error('unexpected external in bundle: ' + id)
}

const mod = await import('../lib/client.js')
assert(captured.has('dsh-tiny-tool'), 'bundle must self-register under id "dsh-tiny-tool"')

const factory = captured.get('dsh-tiny-tool')
let result, threw = null
try { result = factory(requireShim) } catch (e) { threw = e }

if (threw) { console.log('factory() THREW (this was "import failed: module is not defined"):', threw && threw.message); process.exit(1) }

assert(result && typeof result.apply === 'function', 'returned object must expose apply(fn)')
assert(Array.isArray(result.inject), 'returned object must expose inject[] array')
console.log('factory() returned cleanly -> apply=%s inject=%o', typeof result.apply, result.inject)
console.log('SANITY-LOAD-PASS')
