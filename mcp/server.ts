#!/usr/bin/env node
// MCP server for React design review tools.
// Runs via stdio so Claude Code can call it as a local function.
//
// Registration (~/.claude/settings.json):
//   "mcpServers": {
//     "fe-engineer": {
//       "command": "node",
//       "args": ["--experimental-strip-types", "C:/Users/saqib/dev/fe-engineer/mcp/server.ts"]
//     }
//   }
//
// Tools exposed:
//   lint_fix         — Biome format + lint (NODE distribution)
//   audit_ui         — JSX wiring audit (every button must do something)
//   audit_a11y       — Accessibility audit (WCAG-referenced)
//   scan_design      — Design-system anti-pattern scan (inline styles, hardcoded colours, etc.)
//   read_file        — Read a local file and run all four audits at once

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { z } from 'zod';

import { auditUi } from '../src/lib/ui-audit.ts';
import { auditA11y } from './a11y-audit.ts';
import { scanDesign } from './design-scan.ts';

// Biome with NODE distribution (wasm-nodejs, not wasm-web used in the Worker).
import { Biome, Distribution } from '@biomejs/js-api';

let _biome: Biome | null = null;
async function getBiome(): Promise<Biome> {
  if (!_biome) {
    _biome = await Biome.create({ distribution: Distribution.NODE });
    _biome.applyConfiguration({
      formatter: { enabled: true, indentStyle: 'space', indentWidth: 2, lineWidth: 100 },
      linter: { enabled: true, rules: { recommended: true } },
      javascript: { formatter: { quoteStyle: 'single', semicolons: 'always' } },
    });
  }
  return _biome;
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'fe-engineer',
  version: '0.2.0',
});

// ── Tool: lint_fix ───────────────────────────────────────────────────────────

server.tool(
  'lint_fix',
  'Format and lint a React/TypeScript file with Biome. Returns the formatted source plus any remaining lint findings.',
  {
    code: z.string().describe('Source code to format and lint'),
    filePath: z.string().optional().describe("Virtual filename e.g. 'Button.tsx' — controls parser and lint rules"),
  },
  async ({ code, filePath = 'Component.tsx' }) => {
    const biome = await getBiome();
    let formatted = code;
    try {
      const res = biome.formatContent(code, { filePath });
      if (res.content) formatted = res.content;
    } catch { /* unparseable — keep original, lint will surface the error */ }

    let diagnostics: any[] = [];
    try {
      diagnostics = biome.lintContent(formatted, { filePath }).diagnostics ?? [];
    } catch (err) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ formatted, error: String(err) }, null, 2) }] };
    }

    const findings = diagnostics.map((d: any) => ({
      severity: d.severity ?? 'error',
      category: d.category ?? null,
      message: d.description ?? 'Unknown issue',
    }));

    const changed = formatted !== code;
    const result = { filePath, changed, findings, errorCount: findings.filter((f: any) => f.severity === 'error').length, formatted };
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Tool: audit_ui ───────────────────────────────────────────────────────────

server.tool(
  'audit_ui',
  'Audit every interactive element in a React component: flags empty onClick handlers, handlers referencing undefined symbols, buttons with no handler, and undefined components. Use before shipping any UI.',
  {
    code: z.string().describe('JSX/TSX source to audit'),
    filePath: z.string().optional().describe("Filename e.g. 'Panel.tsx'"),
  },
  async ({ code, filePath = 'Component.tsx' }) => {
    const report = auditUi(code, filePath);
    return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
  },
);

// ── Tool: audit_a11y ─────────────────────────────────────────────────────────

server.tool(
  'audit_a11y',
  'Accessibility audit: checks for missing alt text, unlabelled inputs, non-semantic interactive elements, icon-only buttons with no aria-label, bare SVGs, and more. Each finding references the relevant WCAG criterion.',
  {
    code: z.string().describe('JSX/TSX source to audit'),
    filePath: z.string().optional().describe("Filename e.g. 'Form.tsx'"),
  },
  async ({ code, filePath = 'Component.tsx' }) => {
    const report = auditA11y(code, filePath);
    return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
  },
);

// ── Tool: scan_design ────────────────────────────────────────────────────────

server.tool(
  'scan_design',
  'Static design-quality scan: flags inline style props, hardcoded hex/rgb colours, off-grid spacing values, God Components (> 150 JSX elements), deeply nested ternaries, missing list keys, and absent semantic HTML. Use alongside visual review.',
  {
    code: z.string().describe('JSX/TSX source to scan'),
    filePath: z.string().optional().describe("Filename e.g. 'Dashboard.tsx'"),
  },
  async ({ code, filePath = 'Component.tsx' }) => {
    const report = scanDesign(code, filePath);
    return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
  },
);

// ── Tool: review_file ────────────────────────────────────────────────────────

server.tool(
  'review_file',
  'Read a local .tsx/.jsx/.ts file by path and run all four audits (lint, UI wiring, accessibility, design scan) in one call. Returns a combined report. Use this as the starting point for any design review.',
  {
    filePath: z.string().describe('Absolute or relative path to the file on disk'),
    cwd: z.string().optional().describe('Working directory for resolving relative paths (defaults to process.cwd())'),
  },
  async ({ filePath, cwd }) => {
    const base = cwd ?? process.cwd();
    const resolved = filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath)
      ? filePath
      : `${base}/${filePath}`;

    let code: string;
    try {
      code = readFileSync(resolved, 'utf8');
    } catch (err) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Could not read file: ${err}` }) }] };
    }

    const ext = extname(resolved).toLowerCase();
    const isJsx = ['.tsx', '.jsx'].includes(ext);

    const biome = await getBiome();
    let formatted = code;
    try {
      const res = biome.formatContent(code, { filePath: resolved });
      if (res.content) formatted = res.content;
    } catch { /* keep original */ }

    let diagnostics: any[] = [];
    try {
      diagnostics = biome.lintContent(formatted, { filePath: resolved }).diagnostics ?? [];
    } catch { /* ignore */ }

    const lintFindings = diagnostics.map((d: any) => ({
      severity: d.severity ?? 'error',
      category: d.category ?? null,
      message: d.description ?? 'Unknown issue',
    }));

    const result = {
      filePath: resolved,
      linesOfCode: code.split('\n').length,
      lint: {
        changed: formatted !== code,
        errorCount: lintFindings.filter((f: any) => f.severity === 'error').length,
        findings: lintFindings,
      },
      ...(isJsx ? {
        uiWiring: auditUi(code, resolved),
        a11y: auditA11y(code, resolved),
        design: scanDesign(code, resolved),
      } : {}),
    };

    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
