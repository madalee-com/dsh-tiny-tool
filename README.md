# dsh-tiny-tool

Hide all tool/MCP descriptions from the DSH system prompt. Exposes them on demand via bridge tools.

## What it does

- Replaces every tool schema in the model-visible system prompt with a minimal stub (name only, empty description)
- Keeps full schemas in-memory
- Provides two bridge tools:
  - `tool_describe(name)` — returns the full schema for one tool
  - `tool_search(query)` — keyword-searches the catalog, returns matching names

The model can still call tools through the normal mechanism — it just won't see parameter details in the system prompt. Use `tool_describe` to reveal a schema when needed, then call the tool directly.

## Installation

### Via dsh plugin install

```bash
dsh plugin install --profile web github:madalee-com/dsh-tiny-tool
```

### Manual installation

Add to your DSH profile's `package.json`:

```json
{
  "dependencies": {
    "dsh-tiny-tool": "file:/path/to/dsh-tiny-tool"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-tiny-tool"]
    }
  }
}
```

## Configuration

Add the cordis patch directly to your `cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-tiny-tool
      name: 'dsh-tiny-tool'
      config:
        exemptTools:
          - bash
          - read
          - write
```

Tools in `exemptTools` will keep their full descriptions and parameters in the system prompt.

## Building

```bash
npm run build
```
