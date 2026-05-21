# fe-engineer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node ≥22](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-stdio-blue)](https://modelcontextprotocol.io)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com)

A React/TypeScript code reviewer that runs as an MCP server inside Claude Code, or as an always-on Cloudflare Worker chat agent. Point it at a component and optionally your design file — it runs static analysis via Babel AST and returns structured findings: lint, UI wiring, accessibility, and design-system drift.

No hallucinations about what the code says. Everything is AST-level, deterministic.

---

## Two modes

**MCP server** — runs locally as a stdio process, Claude Code calls it as a function. Works on a MAX subscription, no API account needed. Good for: personal use, one-off reviews, local CI.

**Cloudflare Worker** — always-on chat agent backed by a SQLite Durable Object. Workers AI handles completions (qwen2.5-coder-32b). Good for: team-shared URL, persistent conversation history.

---

## What gets caught

**UI wiring** (Babel AST)
- `onClick` referencing an undefined symbol
- Buttons with no handler
- Components used but never imported
- Empty arrow function handlers (`onClick={() => {}}`)

**Accessibility** — WCAG referenced on every finding
- `<img>` missing `alt`
- `<input>` with no `aria-label`, `aria-labelledby`, or paired `<label>`
- `<div onClick>` with no `role` or `tabIndex`
- `<button>` with no accessible name (icon-only, no aria-label)
- `<svg>` that's neither `aria-hidden` nor labelled

**Design system**
- Inline `style` props that bypass your design system
- Hardcoded hex/rgb values — flagged against your token set if you provide one
- Off-grid spacing (not a multiple of 4px)
- God components (>150 JSX elements)
- Nested ternaries 2+ deep in JSX
- `.map()` returns without a `key` prop
- No semantic HTML (`main`, `section`, `nav`, etc.) in large files

---

## MCP server

### Setup

```bash
git clone https://github.com/sk1b-yak/fe-engineer.git
cd fe-engineer
npm install
```

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "fe-engineer": {
      "command": "node",
      "args": ["--experimental-strip-types", "/absolute/path/to/fe-engineer/mcp/server.ts"]
    }
  }
}
```

Restart Claude Code. Tools show up as `mcp__fe-engineer__*`.

### Tools

| Tool | What it does |
|------|-------------|
| `review_file` | Read a file from disk and run all four audits. Start here. |
| `generate_tokens` | Parse a DESIGN.md and write a `tokens.css`. Handles markdown color tables and CSS code blocks — no existing token file needed. |
| `load_design_context` | Parse an existing design baseline (tokens.css, tokens.json) into structured context. |
| `lint_fix` | Biome format + lint on a source string. Returns reformatted source. |
| `audit_ui` | UI wiring audit on a source string. |
| `audit_a11y` | Accessibility audit on a source string. |
| `scan_design` | Design scan on a source string. |

### Design file

Pass `designFile` to `review_file` or `scan_design` and the scanner loads your actual token set before running:

```
mcp__fe-engineer__review_file({
  filePath: "src/components/PriceChart.tsx",
  designFile: "docs/DESIGN.md",
  cwd: "/path/to/project"
})
```

Supported formats:
- **Markdown** — extracts component names from headings and `` `CodeSpans` ``
- **CSS** — extracts `--color-*`, `--space-*`, `--gap-*` custom properties
- **JSON** — flattens nested token objects, matches keys by name pattern

Without a design file, the scanner flags generic anti-patterns. With one, it can say "this `#0f172a` isn't in your `--color-surface` token" instead.

---

## Cloudflare Worker

```
GET  /_selftest                      # health check, no auth, exercises Biome + audit
POST /api/audit  Bearer <token>      # one-shot static audit
WS   /agents/FeEngineer?key=<token>  # persistent chat agent
```

### Deploy

```bash
wrangler secret put CHAT_API_KEY
npm run build:client
wrangler deploy
```

Auth is `Authorization: Bearer <key>` for HTTP and `?key=<key>` for WebSocket (browsers can't set custom headers on WS upgrades).

Leave `CHAT_API_KEY` unset in local dev and auth is disabled.

### Bindings

| Binding | Purpose |
|---------|---------|
| `AI` | Workers AI — qwen2.5-coder-32b-instruct |
| `FeEngineer` | Durable Object — SQLite conversation state |
| `BROWSER` | Browser Rendering — optional CDP runtime audit |
| `ASSETS` | Static chat client (Vite build) |
| `CHAT_API_KEY` | Wrangler secret — auth gate |

---

## Project structure

```
mcp/
  server.ts           ← MCP stdio entry (6 tools)
  a11y-audit.ts       ← accessibility checker
  design-scan.ts      ← design scanner + design context parser
src/
  index.ts            ← Worker routing + auth
  agent.ts            ← AIChatAgent Durable Object
  lib/
    auth.ts           ← Bearer + ?key= helper
    biome.ts          ← Biome WASM wrapper (initSync, workerd-safe)
    ui-audit.ts       ← JSX wiring audit
    runtime-audit.ts  ← CDP Browser Rendering audit (optional)
client/
  src/App.tsx         ← React chat UI (AI SDK v6)
scripts/
  test-audit.ts
  test-lint.ts
```

---

## Notes

**Biome WASM split** — workerd doesn't support the Node.js Biome distribution. The Worker uses `@biomejs/wasm-web` + `Distribution.WEB` + `initSync({ module: biomeWasm })`. The MCP server uses `@biomejs/wasm-nodejs` + `Distribution.NODE`. Mixing these causes silent failures.

**AI SDK v6** — `useAgentChat` returns `{ messages, sendMessage, status }`. Messages use `parts[]` not `content`. Send via `sendMessage({ text })`.

**WebSocket auth** — browsers can't send custom headers on WS upgrades. Token goes as `?key=<token>`, `useAgent` supports a `query` option for this.

---

## Scripts

```bash
npm run dev              # wrangler dev → :8787
npm run dev:client       # Vite → :5173 (proxies to :8787)
npm run build:client     # Vite build → public/
npm run typecheck        # Worker
npm run typecheck:client # React client
npm test                 # audit + lint smoke tests
```

---

## Contributing

Things that would make this more useful:

- More a11y rules — `aria-*` validation, focus trap detection, color contrast estimation
- More design token formats — Style Dictionary, Figma Tokens Plugin JSON
- `review_directory` tool — batch all `.tsx` files in a path
- Better `.map()` detection — currently only catches direct arrow return, misses block-body returns

Run `npm test` before opening a PR.

---

## License

MIT
