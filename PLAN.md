# "FE Engineer" Agent — front-end engineer with built-in linting + UI wiring audit

> Working copy of the approved build plan (status: BUILT & deployed 2026-05-21 to
> https://fe-engineer.d4nkcloud.workers.dev). Retained per the "always save plan copies" rule.

## Context

An AI agent on the **Cloudflare Agents SDK** that behaves like a front-end engineer:
generates/edits React/frontend code, has **built-in linting that self-corrects its output
before returning**, and can thoroughly **audit a UI — verify every button does something,
double-check all wiring**.

Locked decisions:
- **Lint engine:** Biome via WASM, in-Worker (`@biomejs/js-api`).
- **Codegen model:** Workers AI direct — `@cf/qwen/qwen2.5-coder-32b-instruct`.
- **Interface:** chat (`AIChatAgent` + React `useAgentChat`).
- **Location:** new standalone Worker (`C:\Users\saqib\dev\fe-engineer`).

## Architecture

One DO: `FeEngineer extends AIChatAgent<Env>`. Three AI-SDK tools the model calls + self-corrects:
1. **generate_component** — codegen → Biome lint-and-fix loop → clean code.
2. **lint_fix** — lint + autofix pasted code.
3. **audit_ui** — static JSX wiring audit (always) + optional runtime CDP click-through.

## Key implementations (as built)
- **Chat + Workers AI** (`src/agent.ts`): `createWorkersAI({binding: env.AI})` + `streamText`
  in `onChatMessage`, `stopWhen: stepCountIs(6)`, always pass `abortSignal` + `onFinish`.
- **Biome WASM** (`src/lib/biome.ts`): the critical fix — js-api's loader never instantiates
  the wasm in workerd, so manually `initSync({ module: biomeWasm })` with a wrangler-imported
  `@biomejs/wasm-web/biome_wasm_bg.wasm`, then `Biome.create({distribution: WEB})`.
- **Lint-and-fix loop** (`src/lib/lint-fix.ts`): format → lint → model-repair → repeat up to
  maxPasses (3), then disclose remaining; never loops forever.
- **Static UI audit** (`src/lib/ui-audit.ts`): `@babel/parser` walk; flags missing/no-op/
  undefined handlers + undefined components.
- **Runtime audit** (`src/lib/runtime-audit.ts`): `connectBrowser`/`CdpSession` click-through.
- **HTTP** (`src/index.ts`): `/api/audit` (free static audit), `/_selftest` health route.

## Config
- `wrangler.jsonc`: `nodejs_compat`; DO binding `FeEngineer` + migration `v1`
  (`new_sqlite_classes`); `ai`, `browser`, `assets` bindings.
- `tsconfig.json`: **no `experimentalDecorators`**.
- Version set: `@cloudflare/ai-chat` targets **AI SDK v6** (`ai@^6`, `@ai-sdk/react@^3`,
  `agents@^0.13`, `zod@^4`, `react@^19`); plus `@biomejs/wasm-bundler`, `@cloudflare/codemode`.

## Verification (done)
- `tsc --noEmit` clean; `npm run test:audit` (detects all issue classes; HyperMap UI clean),
  `npm run test:lint` (Biome formats + flags); dry-run + live deploy; `/_selftest` returns
  `biomeReady: true`; live AI lint-fix loop returns `clean=true`.

## Status
BUILT, verified, deployed. `/api/audit` swept HyperMap UI: 12 files, 55 interactive, 0 errors.
