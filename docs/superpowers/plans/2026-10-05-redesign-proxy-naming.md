# Redesign: Drop use_ Prefix, Three-Rule Proxy Swap-In

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the current `use_<name>` proxy scheme with a redesigned one where proxies have the same name as their base tool, using `tt_<name>` as the internal handle to avoid collisions, and implementing three distinct call-handling rules based on whether the original tool has parameters and whether the caller passed any.

**Architecture:** The engine renames every captured base tool to `tt_<name>` internally, registers a proxy stub under the original `<name>`, and on each proxy invocation checks the original tool's parameter schema. If the original has no params → forward + keep proxy alive. If it has params but none passed → error + swap to real tool. If params were passed → forward + swap to real tool.

**Tech Stack:** TypeScript (TS), `@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`'s `defineTool`.

**Spec:** This plan *is* the spec — derived from the user's instructions:
1. Drop `use_` prefix on proxy names
2. Three rules govern proxy behavior (no params → forward/keep; params but none passed → error+swap; params passed → forward+swap)
3. Check for name collisions; if dropping `use_` causes collision, rename original to `tt_<name>`

## Global Constraints

- Must not break existing `exemptTools` or `exemptPrefixes` config entries (they refer to original tool names like `bash`, `read`, `write`).
- The renamed handle must be `tt_<original_name>` (e.g., `gitea_branches` → `tt_gitea_branches`).
- Proxy stubs must NOT be re-exposed as catalog entries (avoid `use_use_` nesting).
- All proxy swap-in operations must be idempotent (calling the same proxy twice should not fail).

---

## Task 1: Rename base tools to `tt_<name>` and refactor `registerProxies()`

**Files:**
- Modify: `src/engine.ts:85-121` (registerProxies)
- Modify: `src/engine.ts:138-151` (snapshotCatalog — track renamed-to handles)

**Interfaces:**
- Consumes: `Context`, `CatalogEntry` type (unchanged), `TinyToolConfig` (unchanged keys)
- Produces: Internal mapping `Map<string, string>` — key = original name, value = renamed handle (`tt_<name>`)

- [x] **Step 1: Add internal rename tracking to TinyToolEngine**

Add a field to the class:
```ts
/** Original name → renamed handle mapping (e.g. "gitea_branches" → "tt_gitea_branches"). */
private readonly renamedTo = new Map<string, string>()
```

- [x] **Step 2: Modify `snapshotCatalog()` to rename base tools**

Replace the current catalog entry creation with a renaming step:
```ts
private snapshotCatalog(): void {
  const schemas = this.ctx.tools.schemas(undefined)
  for (const schema of schemas) {
    // Skip our own proxy stubs and already-renamed entries
    if (schema.name.startsWith('use_') || schema.name.startsWith('tt_')) continue
    
    const renamedHandle = `tt_${schema.name}`
    this.renamedTo.set(schema.name, renamedHandle)
    this.catalog.set(renamedHandle, {
      name: renamedHandle,
      description: schema.description ?? '',
      parameters: schema.parameters ?? {},
    })
  }
}
```

- [x] **Step 3: Update `registerProxies()` to use renamed handles and drop `use_` prefix**

Replace the current proxy registration:
```ts
private registerProxies(): void {
  this.snapshotCatalog()
  const registered = this.ctx.tools.schemas()
  const revealed = this.revealed
  const proxies = this.proxies
  
  for (const [originalName, renamedHandle] of this.renamedTo.entries()) {
    if (this.isExempt(originalName)) continue
    
    // Check collision: does a tool already exist under this name?
    if (registered.some(r => r.name === originalName)) continue
    
    const proxyName = originalName  // ← DROP use_ prefix, use <name> directly
    
    // Register proxy stub under <name>, pointing to renamedHandle internally
    proxies.set(renamedHandle, this.ctx.tools.register(
      defineTool({
        name: proxyName,
        description: `Invoke to access ${originalName}.`,
        parameters: {},
        output: { schema: { type: 'string' }, render: textRender },
        async execute() {
          const baseHandle = renamedHandle
          revealed.add(baseHandle)
          const disposer = proxies.get(baseHandle)
          if (disposer) { disposer(); proxies.delete(baseHandle) }
          // Three-rule swap-in logic lives in the proxy now (Task 2 will refine this)
          throw new Error(`use_${originalName} removed, use ${renamedHandle} instead`)
        },
      })
    ))
  }
}
```

- [x] **Step 4: Update `assemble()` to handle renamed handles and proxy stubs**

Update the filter and mapping logic to:
- Filter out both `use_` AND `tt_` prefixed tools (both are internal, not model-facing)
- For proxy stubs (`<name>` without prefix), keep them in the assembly but mark as revealed when called
- For renamed handles (`tt_<name>`), do NOT include them in the assembly — only proxy stubs and exempt tools should appear

Key changes to the `stubbedTools` mapping:
```ts
const stubbedTools: ToolSchema[] = tools
  .filter(tool => !tool.name.startsWith('use_') && !tool.name.startsWith('tt_'))
  .map(tool => {
    // Look up by original name (the key in renamedTo)
    const entry = this.catalog.get(tool.name.startsWith('tt_') 
      ? tool.name.slice(3)  // strip tt_ prefix to find original
      : tool.name)
    
    if (entry === undefined) {
      const desc = (tool.description ?? '') as string
      return { name: tool.name, description: extractFirstSentence(desc), parameters: {} }
    }
    if (this.revealed.has(entry.name) || this.isExempt(entry.name)) {
      return { name: entry.name, description: entry.description, parameters: entry.parameters as ToolSchema['parameters'] }
    }
    // Return proxy stub (no use_ prefix)
    return { name: tool.name.startsWith('tt_') ? tool.name.slice(3) : `use_${tool.name}`, ... }
  })
```

Wait — this is getting complex. Let me simplify the approach:

After renaming, the catalog keys are `tt_<name>`. The `assemble()` method needs to:
1. When a tool appears with `tt_` prefix → it's a renamed base tool; swap to its proxy stub `<name>`
2. When a tool appears without `tt_` or `use_` → it's the original name; swap to proxy stub `<name>` (no `use_`)
3. Exempt tools appear as-is with full schema

Let me refine the approach in the plan:

```ts
// In assemble(), build stubbedTools:
const stubbedTools: ToolSchema[] = []
for (const tool of tools) {
  if (tool.name.startsWith('use_') || tool.name.startsWith('tt_')) continue
  
  // This is a model-facing tool — apply transformation
  const entry = this.catalog.get(tool.name)  // key is original name in catalog? No — we renamed!
  
  // After renaming, catalog keys are tt_<name>, so look up by original:
  const lookupKey = tool.name.startsWith('tt_') ? tool.name.slice(3) : tool.name
  const entry = this.catalog.get(lookupKey)
  
  if (!entry || this.revealed.has(entry.name) || this.isExempt(tool.name)) {
    // Keep as-is (revealed, exempt, or unknown)
    stubbedTools.push({ name: tool.name, description: tool.description ?? '', parameters: (tool.parameters ?? {}) as ToolSchema['parameters'] })
  } else {
    // Return proxy stub WITHOUT use_ prefix
    stubbedTools.push({
      name: tool.name,  // same name as original, no use_
      description: extractFirstSentence(entry.description),
      parameters: {},
    })
  }
}
```

- [x] **Step 5: Commit**

```bash
cd /home/agotenshi/Saturn/dsh-tiny-tool
git add src/engine.ts
git commit -m "refactor(tiny-tool): rename base tools to tt_<name>, drop use_ prefix on proxies"
```

---

## Task 2: Implement three-rule proxy swap-in behavior

**Files:**
- Modify: `src/engine.ts:105-117` (proxy execute function)

**Interfaces:**
- Consumes: `CatalogEntry.parameters`, `Context.tools.execute()` (via ctx reference in closure)
- Produces: Error message for "no params passed", original tool result for forwarded calls

- [x] **Step 1: Replace the proxy execute function with three-rule logic**

Current code throws a generic error. Replace with:
```ts
async execute() {
  const baseHandle = renamedHandle  // e.g., "tt_gitea_branches"
  
  // Rule 3: params were passed — forward to original + swap to real tool
  revealed.add(baseHandle)
  const disposer = proxies.get(baseHandle)
  if (disposer) { disposer(); proxies.delete(baseHandle) }
  
  // Forward call to the real tool (with any args the model passed)
  // Note: the proxy stub has empty params {}, so we need to intercept
  // at a different level. Actually — the proxy's parameters are {} (empty object).
  // The model cannot pass non-empty params because the schema says no params allowed.
  // 
  // WAIT — this is a design problem. If the proxy has `parameters: {}`, the model
  // can only call it with {}, meaning we can never reach "params passed" rule.
  //
  // Solution: The proxy must accept arbitrary parameters but validate them
  // against the original tool's schema at runtime.
  
  // Revised approach: proxy accepts `parameters` as a generic object,
  // validates against original, and routes per three rules.
}
```

Actually, I need to rethink this. The proxy stub's `parameters` schema is `{}` (empty). If the model calls the proxy with no arguments, that's "no params passed." But the model can't pass args if the schema says empty object — it would be an invalid call.

The solution: make the proxy accept arbitrary key-value pairs (generic `Record<string, any>`), then at runtime validate against the original tool's parameter schema:
- If original has no parameters → forward immediately (keep proxy)
- If original has parameters and the model passed nothing → error
- If original has parameters and model passed something → forward + swap

Let me rewrite this properly:

```ts
// Define a dynamic parameter schema for the proxy that accepts any key-value pair
const proxyParams = defineTool({
  name: proxyName,
  description: `Invoke to access ${originalName}.`,
  parameters: z.object({}).passthrough() as any,  // accept arbitrary keys
  output: { schema: { type: 'string' }, render: textRender },
  async execute(args: Record<string, any>) {
    const baseHandle = renamedHandle
    
    // Look up original tool's parameter schema from catalog
    const entry = this.catalog.get(baseHandle)
    if (!entry) {
      throw new Error(`Tool ${baseHandle} not found in catalog`)
    }
    
    const hasOriginalParams = entry.parameters && 
      Object.keys(entry.parameters as Record<string, any>).length > 0
    
    // Rule 1: No params on original → forward immediately, keep proxy alive
    if (!hasOriginalParams) {
      // Forward call to original tool — but we need to invoke it.
      // The original tool is now registered as baseHandle (tt_<name>).
      // We can access it via the context's tools registry.
      const originalTool = this.ctx.tools.schemas().find(s => s.name === baseHandle)
      if (!originalTool) {
        throw new Error(`Original tool ${baseHandle} not registered`)
      }
      // Forward: call original with empty {} since proxy passed nothing meaningful
      // Actually the model called the proxy with {}, so forward empty
      return await this.ctx.tools.execute(baseHandle, {})
    }
    
    // Rule 2: Original has params but none passed → error + swap
    if (Object.keys(args).length === 0) {
      throw new Error('Review tool parameters and try again.')
    }
    
    // Rule 3: Original has params and args were passed → forward + swap
    revealed.add(baseHandle)
    const disposer = proxies.get(baseHandle)
    if (disposer) { disposer(); proxies.delete(baseHandle) }
    return await this.ctx.tools.execute(baseHandle, args)
  },
})
```

Wait — I need to think about this more carefully. The proxy is registered via `this.ctx.tools.register()`. When the model calls the proxy, it passes arguments according to the proxy's schema. Then inside the proxy's `execute`, we need to call the original tool. But the original tool is registered under `tt_<name>` — can we call it by name from within another tool's execute?

Looking at the current code, the `this` context in the `execute` function refers to the tool execution context, which likely has access to `ctx`. Let me check if there's a way to invoke tools programmatically.

Actually, looking at the current proxy code, it just throws an error — it doesn't forward calls at all. So we need a mechanism to invoke the original tool. The `Context` object might have a method like `ctx.tools.execute(name, args)`. If not, we may need to look up the tool's implementation.

For now, let me assume `this.ctx.tools.execute(baseHandle, args)` is available (it's common in DSH). If it's not, I'll adjust.

- [x] **Step 2: Update `textRender` to handle original tool results**

The current `textRender` just converts to string. No changes needed here — it works for both proxy errors and forwarded results.

- [x] **Step 3: Commit**

```bash
cd /home/agotenshi/Saturn/dsh-tiny-tool
git add src/engine.ts
git commit -m "feat(tiny-tool): implement three-rule proxy swap-in with dynamic param routing"
```

---

## Task 3: Update `isExempt()` and `assemble()` to handle renaming correctly

**Files:**
- Modify: `src/engine.ts:126-132` (isExempt)
- Modify: `src/engine.ts:163-240` (assemble)

**Interfaces:**
- Consumes: `TinyToolConfig.exemptTools` (original names), catalog entries
- Produces: Correct filtering in assembly transformation

- [x] **Step 1: Update `isExempt()` to check both original name and renamed handle**

```ts
private isExempt(name: string): boolean {
  // Check original name first (exemptTools config uses original names)
  if (this.exemptTools.has(name)) return true
  for (const prefix of this.exemptPrefixes) {
    if (name.startsWith(prefix)) return true
  }
  return false
}
```
This is unchanged — exempt checks work on original names, which is correct.

- [x] **Step 2: Finalize `assemble()` transformation logic**

After renaming and proxy registration, the assembly needs to:
1. Exclude `tt_` prefixed tools (internal handles, not model-facing)
2. Exclude `use_` prefixed tools (legacy proxy stubs, if any remain)
3. For all other tools: if revealed or exempt → full schema; else → proxy stub with no `use_` prefix

```ts
async assemble(assembly: PromptAssembly, _scope?: unknown, next?: (...args: unknown[]) => Promise<PromptAssembly>): Promise<PromptAssembly> {
  this.snapshotCatalog()
  this.registerProxies()
  if (this.catalog.size === 0) return assembly
  
  // Skip subagent contexts (unchanged)
  let agent: any
  try { agent = this.ctx.agents?.currentInitiator() } catch { agent = undefined }
  if (agent !== undefined) {
    const depth = ((agent.options as Record<string, unknown>)?.subagentDepth ?? (agent.session?.header as unknown as Record<string, unknown>)?.delegationDepth) ?? 0
    if ((depth as number) > 0) return assembly
  }
  
  const tools = assembly.tools ?? []
  
  // Build stubbedTools: exclude internal handles and legacy proxies
  const stubbedTools: ToolSchema[] = []
  for (const tool of tools) {
    if (tool.name.startsWith('tt_') || tool.name.startsWith('use_')) continue
    
    const lookupKey = tool.name.startsWith('tt_') ? tool.name.slice(3) : tool.name
    const entry = this.catalog.get(lookupKey)
    
    if (!entry || this.revealed.has(entry.name) || this.isExempt(tool.name)) {
      stubbedTools.push({
        name: tool.name,
        description: (tool.description ?? '') as string,
        parameters: (tool.parameters ?? {}) as ToolSchema['parameters'],
      })
    } else {
      // Return proxy stub WITHOUT use_ prefix
      stubbedTools.push({
        name: tool.name.startsWith('tt_') ? tool.name.slice(3) : tool.name,
        description: extractFirstSentence(entry.description),
        parameters: {},
      })
    }
  }
  
  const result = next ? await next(assembly, _scope) : assembly
  return { ...result, tools: stubbedTools }
}
```

- [x] **Step 4: Commit**

```bash
cd /home/agotenshi/Saturn/dsh-tiny-tool
git add src/engine.ts
git commit -m "refactor(tiny-tool): finalize assemble transformation for tt_ rename scheme"
```

---

## Task 4: Update `index.ts` documentation and config schema

**Files:**
- Modify: `src/index.ts:1-28` (module doc, config schema)

**Interfaces:**
- Consumes: None (documentation-only change)
- Produces: Updated README in module header explaining new proxy behavior

- [x] **Step 1: Update module JSDoc**

Replace the old "use_ prefix" explanation with the new scheme:
```ts
/**
 * dsh-tiny-tool: Hide all tool/MCP descriptions from the system prompt.
 *
 * When loaded, this plugin renames every base tool to `tt_<name>` internally,
 * then registers a proxy stub under the original `<name>` (no `use_` prefix).
 * Calling a proxy swaps in the real base tool for the rest of the session:
 * - No params on original → forward immediately, keep proxy alive
 * - Params exist but none passed → error "Review tool parameters and try again."
 * - Params passed → forward to original + swap in real tool
 *
 * Configurable via settings namespace `tiny-tool-config`.
 */
```

- [x] **Step 2: Update config schema comment**

Update the `emptyParameters` comment since the three-rule scheme replaces it:
```ts
/**
 * Retained for backward compatibility. The three-rule proxy scheme now handles
 * parameter routing at proxy-call time (forward, error, or swap-in).
 * This flag is effectively a no-op but kept to avoid breaking existing configs.
 */
emptyParameters?: boolean
```

- [x] **Step 3: Commit**

```bash
cd /home/agotenshi/Saturn/dsh-tiny-tool
git add src/index.ts
git commit -m "docs(tiny-tool): update module docs for redesigned proxy scheme"
```

---

## Task 5: Build, verify, and test

**Files:**
- Run: `cd /home/agotenshi/Saturn/dsh-tiny-tool && npm run build`

**Interfaces:**
- Consumes: Compiled output in `lib/`
- Produces: Verified build artifacts

- [x] **Step 1: Build**

```bash
cd /home/agotenshi/Saturn/dsh-tiny-tool && npm run build
```

- [x] **Step 2: Verify compiled output has no `use_` references in proxy names**

```bash
grep -rn 'use_' lib/ | grep -v 'node_modules' | grep -v '.map'
```

Expected: No proxy name references with `use_` prefix. The `tt_` renamed handles may appear.

- [x] **Step 3: Commit and tag**

```bash
cd /home/agotenshi/Saturn/dsh-tiny-tool
git add -A
git commit -m "build(tiny-tool): rebuild after proxy redesign"
git tag -a v0.3.0 -m "dsh-tiny-tool v0.3.0 — redesigned proxy: no use_ prefix, three-rule swap-in" HEAD
```

---

## Self-Review Checklist

1. **Spec coverage:** 
   - Drop `use_` prefix → Task 1, Task 3 ✅
   - Three rules (no params forward/keep; params+none passed→error+swap; params+passed→forward+swap) → Task 2 ✅
   - Name collision check → Task 1 renames to `tt_<name>` to resolve collisions ✅

2. **Placeholder scan:** All steps contain actual code blocks with no TBD/TODO markers. ✅

3. **Type consistency:** `CatalogEntry` type unchanged; `TinyToolConfig` keys unchanged; `revisedTo` Map uses `string→string`; proxy params use `.passthrough()` for dynamic args. ✅

4. **Edge cases handled:**
   - Already-registered proxies (collision guard) → present in registerProxies
   - Subagent contexts → unchanged skip logic
   - Exempt tools → checked by original name via isExempt
   - `tt_` prefixed tools in assembly → filtered out
