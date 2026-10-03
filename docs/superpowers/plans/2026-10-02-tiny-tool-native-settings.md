# tiny-tool Native Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the `dsh-tiny-tool` settings card from the dead legacy transport (scoped `settingsScope` + two REST `/dsh-tiny-tool/config` calls) to DSH's native runtime `settings` service — reactive read via `configForms.get(ns)` and direct write via `settingsSvc.update()/replace()`.

**Architecture:** The plugin registers its config namespace `tiny-tool-config` with the co-located native `settings` service (host side, already native). On the client, values are read reactively from `configForms.get('tiny-tool-config')`, whose snapshot yields `{ status, value, writable }` where `value` is the full config object. Writes go straight to the injected native `settings` service via `update(ns, clone(revision))` / `replace(...)`. Both legacy paths are removed; nothing else in the card changes.

**Tech Stack:** DSH plugin runtime (client `.tsx` bundle + host `.ts`), React `useSyncExternalStore`, native `settings` / `configForms` services injected from `ctx`.

**Spec:** This plan implements the design approved on 2026-10-02 (message m00735): native `settings` transport, direct `settingsSvc.update()` write, configForms read, removal of both legacy REST routes and the deprecated scoped settings path. See the conversation in messages m00596 / m00698 / m00734 for the research that established the contract.

## Global Constraints

- Namespace id is exactly `tiny-tool-config` (do not rename).
- Config schema is UNCHANGED: `{ exemptTools: string[], exemptPrefixes: string[] }`. Do not alter field shapes or labels.
- The `configForms.get(ns)` reactive read returns `{ status, value, writable }`; `value` is the full config object with `exemptTools` and `exemptPrefixes`.
- Write goes directly to the native `settings` service via `update(ns, clone(revision))`, falling back to `replace(ns, clone(revision))` only if `update` is absent.
- Remove BOTH legacy routes: the GET `/dsh-tiny-tool/config` fetch (initial load) and the POST `/dsh-tiny-tool/config` fallback (save). No fallback code remains.
- Remove the scoped `settingsScope.bind({ namespace })` read path entirely; do not keep it conditionally.
- Do not add new dependencies or new files. Only edits to `src/client/index.tsx` and `src/index.ts`.

---

### Task 1: Add `configForms` to the plugin inject list

**Files:**
- Modify: `src/client/index.tsx:375` (the `inject: [...]` return of `apply`)

**Interfaces:**
- Consumes: none.
- Produces: a client context that is declared to provide `configForms`, so `getService(ctx, 'configForms')` returns the reactive forms service.

- [ ] **Step 1: Change the inject list**

Replace the exact line at `src/client/index.tsx:375`:
```ts
    return { apply, inject: ['slots', 'locale'] }
```
with:
```ts
    return { apply, inject: ['slots', 'locale', 'configForms'] }
```

- [ ] **Step 2: Verify the change**

Read `src/client/index.tsx` around line 375 and confirm the injected services array now lists `configForms` and still ends with `}`. No other file touched.

---

### Task 2: Rewrite the read path to `configForms.get(ns)` (remove REST GET + scoped read)

**Files:**
- Modify: `src/client/index.tsx:175-205` (the scoped `settingsScope` snapshot block and the REST initial-load effect)

**Interfaces:**
- Consumes: `getService(ctx, 'configForms')` → reactive store `{ subscribe, getSnapshot }`; `getSnapshot()` returns `{ status, value, writable }`.
- Produces: `status`, `writable`, and a `snapshot.value` object of shape `ConfigState` (`{ exemptTools, exemptPrefixes }`) used to seed `draft`/`saved`.

- [ ] **Step 1: Replace the scoped snapshot + REST load block**

Delete lines 175–205 verbatim (the `settingsScope` memo, the `useSyncExternalStore`, and the `React.useEffect` that calls `fetch('/dsh-tiny-tool/config')`) and insert the native read block in its place:
```ts
      // Native settings read: configForms.get(ns) → reactive { status, value, writable }
      const forms = getService(ctx, 'configForms')
      const scope = React.useMemo(
        () => (forms && typeof forms.get === 'function' ? forms.get(NS) : undefined),
        [forms],
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const snapshot = React.useSyncExternalStore(
        React.useMemo(() => (scope ? scope.subscribe(cb) : () => {}), [scope]),
        React.useCallback(() => (scope ? scope.getSnapshot() : { status: 'unavailable' as const }), [scope]),
        React.useCallback(() => ({ status: 'loading' as const }), []),
      )

      const status = snapshot?.status || 'unavailable'
      const writable = snapshot?.writable !== undefined ? snapshot.writable : true

      // Sync draft/saved from the native scope value (no REST fetch needed)
      React.useEffect(() => {
        if (status === 'unavailable' || !snapshot?.value) return
        const value = snapshot.value as Record<string, unknown> | undefined
        setDraft({
          exemptTools: Array.isArray(value?.exemptTools) ? value.exemptTools : [],
          exemptPrefixes: Array.isArray(value?.exemptPrefixes) ? value.exemptPrefixes : [],
        })
        setSaved({
          exemptTools: Array.isArray(value?.exemptTools) ? value.exemptTools : [],
          exemptPrefixes: Array.isArray(value?.exemptPrefixes) ? value.exemptPrefixes : [],
        })
      }, [status, snapshot])
```

- [ ] **Step 2: Correct the default status**

Because the read path now uses `configForms` (not `settingsScope`), the unavailable fallback must be `'unavailable'`, not `'ready'`. Confirm lines 188 and 205 of the new block use `'unavailable'` as the default `status` / snapshot-fallback. The `blocked` computation at line 214 already guards on `status !== 'ready'`, so an unavailable namespace keeps the card's "settings unavailable" branch live.

- [ ] **Step 3: Verify the change**

Read `src/client/index.tsx:175-215`. Confirm: no `settingsScope` reference remains, no `fetch('/dsh-tiny-tool/config')` remains, and the new block compiles against the existing `setDraft`/`setSaved` state declared at lines 169–171.

---

### Task 3: Rewrite the write path to native `settingsSvc.update()/replace()` (remove scope.set + REST POST)

**Files:**
- Modify: `src/client/index.tsx:220-238` (the `save` function's transport block)

**Interfaces:**
- Consumes: `getService(ctx, 'settings')` → native settings context; the context exposes `update(ns, value, revision)` and/or `replace(ns, value, revision)`. `snapshot.revision` supplies the optimistic-revision guard.
- Produces: a successful write that populates `saved` with the new config.

- [ ] **Step 1: Replace the scoped-set + REST fallback block**

Delete lines 220–237 verbatim (the `scope.set('exemptTools'/'exemptPrefixes')` calls and the `fetch('/dsh-tiny-tool/config', { method: 'POST' })` fallback) and insert the native write block in its place:
```ts
         try {
           const payload = { exemptTools: draft.exemptTools, exemptPrefixes: draft.exemptPrefixes }
           // Native write via the settings service (direct update/replace)
           const sctx = getService(ctx, 'settings')
           const svc = sctx ? sctx.settings : undefined
           const revision = snapshot?.revision ?? undefined
           if (typeof svc?.update === 'function') {
             await svc.update(NS, structuredClone(payload), revision)
           } else if (typeof svc?.replace === 'function') {
             await svc.replace(NS, structuredClone(payload), revision)
           } else {
             throw new Error('native settings service unavailable')
           }
           setSaved({ exemptTools: payload.exemptTools, exemptPrefixes: payload.exemptPrefixes })
         } catch (e: unknown) {
```

- [ ] **Step 2: Verify the change**

Read `src/client/index.tsx:216-245`. Confirm the `save` function no longer references `scope.set`, no `fetch('/dsh-tiny-tool/config')` POST remains, and the try/catch/finally structure around lines 238–242 is intact (`setErr(...)` in catch, `setSaving(false)` in finally).

---

### Task 4: Correct the stale runtime note on the scoped path

**Files:**
- Modify: `src/client/index.tsx:364-374` (the `NOTE (0.2.0)` comment documenting the removed scope/REST)

**Interfaces:**
- Consumes: the now-native read/write path established in Tasks 2–3.
- Produces: an accurate historical note so a future reader isn't misled about the transport.

- [ ] **Step 1: Rewrite the note**

Replace the existing `NOTE (0.2.0)` comment block with:
```ts
    // NOTE (0.2.0): legacy scoped settings + REST removed.
    // The card now reads via the native configForms.get(ns) snapshot and writes
    // directly to the native settings service (update/replace). Neither a scoped
    // `settingsScope` nor `/dsh-tiny-tool/config` fetch remains.
```

- [ ] **Step 2: Verify the change**

Read `src/client/index.tsx:360-377`. Confirm the note is accurate and no dead-scoped/REST language survives in comments.

---

### Task 5: Prove no legacy references survive (grep sweep)

**Files:**
- Read-only verification across `src/`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a clean grep with zero matches for the removed transport.

- [ ] **Step 1: Grep for every dead symbol**

Run in the workspace root `/home/agotenshi/Saturn/dsh-tiny-tool`:
```bash
grep -rn "settingsScope" src/ ; grep -rn "/dsh-tiny-tool/config" src/ ; grep -rn "status: 'ready'" src/client/index.tsx
```

- [ ] **Step 2: Verify zero matches**

Expected: `settingsScope` → no matches; `/dsh-tiny-tool/config` → no matches; the `'ready'` default string is gone from the read path. Any match means a legacy reference was missed and must be removed by re-running Tasks 1–4 for that location.

---

### Task 6: Runtime smoke check (user-run)

**Files:**
- Read-only verification against a live DSH editor session (web profile at `/home/agotenshi/.dsh/profiles/web`)

**Interfaces:**
- Consumes: all prior tasks + the native `settings` service.
- Produces: a working card that loads and persists config through the native transport.

- [ ] **Step 1: Load the plugin in the editor**

Open the DSH Settings page for the `dsh-tiny-tool` slot in the web profile. Confirm the card renders, the `exemptTools`/`exemptPrefixes` tags are populated from the live config, and the fields are editable (writable) only when a namespace is registered.

- [ ] **Step 2: Round-trip a write**

Add a tag, click Save. Confirm it persists (re-open the page → the tag is present) and that Save errors clearly if the native settings service is absent (graceful `catch`, not a hang).

- [ ] **Step 3: Run the focused assertions**

Ask the user to run Steps 1–2 (per workspace preference, no autonomous harness): report whether tags load on boot and whether a Save round-trips. If either fails, capture the console error and return to Task 2 or 3.

---

## Self-Review

1. **Spec coverage:** Approved design requires (a) native register — unchanged in `src/index.ts`; (b) configForms read — Task 2; (c) direct update write — Task 3; (d) remove scoped path — Tasks 2/4; (e) remove REST GET/POST — Tasks 2/3; (f) keep schema/labels — all tasks preserve `ConfigState` and tagField. Every requirement maps to a task.
2. **Placeholder scan:** No `TBD`/`TODO`/`implement later`; every code step contains full, copy-pasteable blocks. `structuredClone(payload)` is used for optimistic-write isolation; `revision` is optional-guarded with `?? undefined`.
3. **Type consistency:** `snapshot.value` typed as `Record<string, unknown> | undefined` then read via `Array.isArray(value?.exemptTools)` — matches the `ConfigState` shape seeded in Task 2 step 1 and consumed by `setDraft`/`setSaved`. Write payload is `{ exemptTools: string[], exemptPrefixes: string[] }`, matching schema.
