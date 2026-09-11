# dsh-tiny-tool Design Document

## Overview

`dsh-tiny-tool` is a DSH plugin that reduces context token usage by hiding tool/MCP descriptions from the system prompt. Full schemas are preserved in-memory and exposed on-demand via two bridge tools: `tool_describe` and `tool_search`.

## Problem

DSH injects all tool schemas into the system prompt at assembly time. Each tool schema contains:
- A description (often verbose)
- A JSON Schema for parameters (nested, detailed)

For profiles with many tools, this can consume hundreds or thousands of tokens before any conversation begins — tokens that could be used for actual context.

## Solution

Replace every tool schema in the model-visible system prompt with a minimal stub:
```json
{ "name": "<tool-name>", "description": "", "parameters": { "type": "object", "properties": {} } }
```

The full schemas remain in-memory and are accessible via bridge tools when the model needs them.

## Architecture

### Components

```
src/
├── index.ts    # Plugin entry point, exports apply()
├── engine.ts   # TinyToolEngine: catalog snapshot + assembly transformation
├── bridge.ts   # Bridge tool registrations (tool_search, tool_describe)
└── lib/        # Compiled output
```

### Data Flow

```
1. Plugin loads → TinyToolEngine constructor
2. snapshotCatalog() captures all current tool schemas into an in-memory Map
3. registerBridgeTools() registers tool_search and tool_describe
4. assemble() waterfall hook transforms every system prompt assembly:
   - For most tools: replace with stub
   - For exemptTools: keep full schema
```

### Key Classes

#### TinyToolEngine

```ts
class TinyToolEngine {
  private ctx: Context
  private catalog: Map<string, CatalogEntry>
  private exemptTools: Set<string>

  constructor(ctx: Context, config: TinyToolConfig = {})
  snapshotCatalog(): void
  describe(name: string): ToolSchema | undefined
  search(query: string): string[]
  assemble(assembly: PromptAssembly, _scope?: unknown): Promise<PromptAssembly>
}
```

**`snapshotCatalog()`** — Runs once at construction. Iterates `ctx.tools.schemas(undefined)` and stores each tool's full schema in the catalog Map. Subsequent tool additions are not captured (they'll be visible only through the normal registry).

**`assemble()`** — The core transformation. Maps over all catalog entries:
- Exempted tools: return full schema (`{ name, description, parameters }`)
- All others: return stub (`{ name, description: '', parameters: { type: 'object', properties: {} } }`)

**`describe(name)`** — Used by `tool_describe`. Returns the full schema from the catalog, or `undefined` if unknown.

**`search(query)`** — Used by `tool_search`. Case-insensitive substring match against both tool names and descriptions.

#### Bridge Tools

**`tool_search(query: string): string[]`**
- Returns matching tool names
- Searches both `entry.name` and `entry.description`
- Result injected into context for later turns

**`tool_describe(name: string): ToolSchema | { error: string }`**
- Returns full schema for one tool
- Returns error JSON if tool not found
- Makes the tool "warm" (visible) after execution

### Configuration

```ts
interface TinyToolConfig {
  /** Tool names to keep fully visible (do not hide descriptions). */
  exemptTools?: string[]
}
```

Example:
```yaml
- insert:
    - id: tiny-tool
      name: 'dsh-tiny-tool'
      config:
        exemptTools:
          - bash
          - read
          - write
```

## Design Decisions

### Why no execution bridge?

The model can call tools through the normal mechanism even when descriptions are hidden. It just won't see parameter details. If it needs them, it calls `tool_describe(name)` to reveal the schema, then calls the tool directly. No separate execution bridge is needed.

### Why substring search instead of full-text?

Simple substring matching is fast and sufficient for tool discovery. The catalog is typically <100 entries, so performance is not a concern. Full-text search would add complexity without meaningful benefit.

### Why store in a Map?

- O(1) lookup for `describe()`
- Preserves insertion order for deterministic output
- Easy to iterate for `search()` and `assemble()`

### Why stub parameters as `{ type: 'object', properties: {} }`?

JSON Schema requires a valid schema even for empty parameters. This stub is minimal but syntactically correct, avoiding validation errors while conveying "no parameters expected".

### Why case-insensitive search?

Users may type tool names in any case. Case-insensitive matching improves discoverability without significant cost.

## Token Savings

**Before:** Each tool adds ~50-200 tokens (description + parameters schema)
**After:** Each tool adds ~10-20 tokens (name only stub)

For a profile with 50 tools averaging 100 tokens each:
- Before: ~5000 tokens
- After: ~500-1000 tokens
- **Savings: ~4000-75% reduction**

## Limitations

1. **Static snapshot** — Tools added after plugin load are not captured in the catalog. They remain visible through the normal registry.
2. **No partial hiding** — A tool is either fully hidden or fully visible (via `exemptTools`).
3. **Bridge tools add ~50 tokens each** — The three bridge tools themselves have schemas, but this is negligible compared to the savings.

## Extension Points

- **Custom search** — Override `search()` for fuzzy matching or AI-ranked results
- **Conditional hiding** — Add logic to `assemble()` for context-aware stubbing (e.g., hide based on agent scope)
- **Dynamic catalog** — Listen for tool registration events to update the snapshot

## Dependencies

| Package | Purpose |
|---------|---------|
| `@deepseek-ai/cordis` | Plugin context, lifecycle |
| `@deepseek-ai/dsh-tools` | `defineTool()`, tool registry |
| `@deepseek-ai/dsh-llm` | `ToolSchema` type |
| `@deepseek-ai/dsh-system-prompt` | `PromptAssembly` type |

## File Structure

```
dsh-tiny-tool/
├── src/
│   ├── index.ts      # Plugin entry, apply() export
│   ├── engine.ts     # TinyToolEngine class
│   └── bridge.ts     # registerBridgeTools()
├── lib/              # Compiled JS + .d.ts + maps
├── cordis.patch.yml  # Bundle patch config
├── package.json      # Package manifest
├── tsconfig.json     # TypeScript config
├── README.md         # Usage documentation
└── DESIGN.md         # This document
```
