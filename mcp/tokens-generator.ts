// Generates a tokens.css from a DESIGN.md (or any design doc).
// Handles three source patterns in order of preference:
//   1. CSS code blocks — ` --var: value; ` (most reliable, already structured)
//   2. Markdown tables with an explicit "CSS Variable" column
//   3. Markdown tables without — infers --color-{name} from Tailwind class names

export interface ExtractedToken {
  name: string;       // --color-surface
  value: string;      // #15111e
  comment: string;    // "Primary canvas" from the Role column
  category: 'color' | 'spacing' | 'typography' | 'other';
}

export interface TokensResult {
  tokens: ExtractedToken[];
  css: string;
  colorCount: number;
  spacingCount: number;
  typographyCount: number;
  warnings: string[];
}

// ── Regex ────────────────────────────────────────────────────────────────────

const HEX_RE = /^#([0-9a-fA-F]{3,8})$/;
const CSS_VAR_RE = /^--[\w-]+$/;
const PX_RE = /^\d+(?:\.\d+)?px$/;
const REM_RE = /^\d+(?:\.\d+)?rem$/;

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripMd(cell: string): string {
  return cell.trim().replace(/`/g, '').trim();
}

/** Split a pipe-delimited markdown table row into cells. */
function parseCells(row: string): string[] {
  return row.split('|').slice(1, -1).map(stripMd);
}

function isTableSep(line: string): boolean {
  return /^\|\s*[-:]+[\s\-:|]*\|/.test(line.trim());
}

/**
 * Convert a Tailwind class name to a CSS custom property name.
 * bg-surface → --color-surface
 * text-on-surface → --color-on-surface
 * border-outline-variant → --color-outline-variant
 * Returns null if unrecognised.
 */
function tailwindToVar(cls: string): string | null {
  // Strip combined tokens like "text-primary / bg-primary" → take first
  const first = cls.split('/')[0]!.trim();
  const m = /^(?:bg|text|border|fill)-([\w-]+)$/.exec(first);
  if (m) return `--color-${m[1]}`;
  return null;
}

function categorise(name: string): ExtractedToken['category'] {
  if (/^--color/.test(name) || /^--bg/.test(name)) return 'color';
  if (/^--(space|padding|margin|gap|size|radius|border-width)/.test(name)) return 'spacing';
  if (/^--(font|text-size|letter|line)/.test(name)) return 'typography';
  return 'other';
}

// ── Phase 1: CSS code blocks ─────────────────────────────────────────────────

function extractFromCodeBlocks(content: string, seen: Set<string>): ExtractedToken[] {
  const tokens: ExtractedToken[] = [];
  // Match ```css ... ``` and plain ``` ... ``` blocks
  const blockRe = /```(?:css)?\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(content)) !== null) {
    const varRe = /--([\w-]+)\s*:\s*([^;}\n]+)/g;
    let vm: RegExpExecArray | null;
    while ((vm = varRe.exec(m[1])) !== null) {
      const name = `--${vm[1].trim()}`;
      const value = vm[2].trim().replace(/\s*\/\*.*\*\//, ''); // strip inline comments
      if (!seen.has(name) && value) {
        seen.add(name);
        tokens.push({ name, value, comment: '', category: categorise(name) });
      }
    }
  }
  return tokens;
}

// ── Phase 2 & 3: Markdown tables ─────────────────────────────────────────────

function extractFromTables(content: string, seen: Set<string>, seenValues: Set<string>): { tokens: ExtractedToken[], warnings: string[] } {
  const tokens: ExtractedToken[] = [];
  const warnings: string[] = [];
  const lines = content.split('\n');

  let headers: string[] = [];
  let hexColIdx = -1;
  let varColIdx = -1;
  let tokenColIdx = -1;
  let roleColIdx = -1;
  let inTable = false;

  for (const raw of lines) {
    const line = raw.trim();

    if (!line.startsWith('|')) {
      inTable = false;
      headers = [];
      hexColIdx = varColIdx = tokenColIdx = roleColIdx = -1;
      continue;
    }

    if (isTableSep(line)) continue;

    const cells = parseCells(line);

    if (!inTable) {
      // Header row — identify column roles
      inTable = true;
      headers = cells.map(c => c.toLowerCase());

      hexColIdx = headers.findIndex(h => h === 'hex' || h === 'value' || h === 'color');
      varColIdx = headers.findIndex(h => /css.?var|variable/.test(h));
      tokenColIdx = headers.findIndex(h => /token|class|utility/.test(h));
      if (tokenColIdx === -1) tokenColIdx = 0;
      roleColIdx = headers.findIndex(h => /role|desc|notes|purpose/.test(h));
      continue;
    }

    // Data row
    if (cells.length < 2) continue;

    // ── Determine value ──────────────────────────────────────────────────────
    let value: string | null = null;

    if (hexColIdx !== -1 && cells[hexColIdx]) {
      const candidate = cells[hexColIdx]!;
      if (HEX_RE.test(candidate)) value = candidate;
    }

    // Fallback: scan all cells for a hex value
    if (!value) {
      for (const c of cells) {
        if (HEX_RE.test(c)) { value = c; break; }
        // px/rem spacing values
        if (PX_RE.test(c) || REM_RE.test(c)) { value = c; break; }
      }
    }

    if (!value) continue;

    // ── Determine name ───────────────────────────────────────────────────────
    let name: string | null = null;

    // Explicit CSS variable column
    if (varColIdx !== -1 && cells[varColIdx]) {
      const candidate = cells[varColIdx]!;
      if (CSS_VAR_RE.test(candidate)) name = candidate;
    }

    // No explicit column — infer from token/class column
    if (!name && tokenColIdx !== -1 && cells[tokenColIdx]) {
      const raw = cells[tokenColIdx]!;
      // Handle "text-primary / bg-primary" style — try each part
      for (const part of raw.split('/')) {
        const inferred = tailwindToVar(part.trim());
        if (inferred) { name = inferred; break; }
      }
      // Last resort: if it's already a CSS var token name in the cell
      if (!name && CSS_VAR_RE.test(raw.split('/')[0]!.trim())) {
        name = raw.split('/')[0]!.trim();
      }
    }

    if (!name) {
      if (HEX_RE.test(value) && !seenValues.has(value))
        warnings.push(`Found hex ${value} but could not determine token name`);
      continue;
    }

    // ── Role comment ─────────────────────────────────────────────────────────
    let comment = '';
    if (roleColIdx !== -1 && cells[roleColIdx]) {
      comment = cells[roleColIdx]!;
    } else {
      // Take the last cell that isn't the name, value, or a Tailwind class
      comment = cells
        .filter(c => c !== value && c !== name && !CSS_VAR_RE.test(c) && !/^(bg|text|border)-/.test(c))
        .pop() ?? '';
    }

    if (!seen.has(name)) {
      seen.add(name);
      seenValues.add(value);
      tokens.push({ name, value, comment, category: categorise(name) });
    }
  }

  return { tokens, warnings };
}

// ── CSS renderer ─────────────────────────────────────────────────────────────

function renderCss(sourceFile: string, tokens: ExtractedToken[]): string {
  const colors = tokens.filter(t => t.category === 'color');
  const spacing = tokens.filter(t => t.category === 'spacing');
  const typography = tokens.filter(t => t.category === 'typography');
  const other = tokens.filter(t => t.category === 'other');

  const maxLen = Math.max(...tokens.map(t => t.name.length), 0);

  function group(items: ExtractedToken[], title: string): string {
    if (!items.length) return '';
    const pad = Math.max(0, 48 - title.length);
    const out = [`\n  /* ── ${title} ${'─'.repeat(pad)} */\n`];
    for (const t of items) {
      const spaces = ' '.repeat(Math.max(1, maxLen - t.name.length + 2));
      const comment = t.comment ? `   /* ${t.comment} */` : '';
      out.push(`  ${t.name}:${spaces}${t.value};${comment}`);
    }
    return out.join('\n') + '\n';
  }

  const src = sourceFile.split(/[\\/]/).pop() ?? sourceFile;
  return [
    `/**`,
    ` * Design Tokens — generated from ${src}`,
    ` * Tool: fe-engineer › generate_tokens`,
    ` * Source-of-truth is the design doc. Regenerate here when tokens change.`,
    ` */`,
    ``,
    `:root {`,
    group(colors, 'Color Tokens'),
    group(spacing, 'Spacing & Sizing'),
    group(typography, 'Typography'),
    group(other, 'Other'),
    `}`,
    ``,
  ].join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

export function generateTokensFromDesign(filePath: string, content: string): TokensResult {
  const seen = new Set<string>();      // seen CSS var names
  const seenValues = new Set<string>(); // seen hex/px values — suppress duplicate warnings
  const warnings: string[] = [];

  // Phase 1: structured CSS blocks (most reliable)
  const fromBlocks = extractFromCodeBlocks(content, seen);
  fromBlocks.forEach(t => seenValues.add(t.value));

  // Phase 2 & 3: markdown tables
  const { tokens: fromTables, warnings: tableWarnings } = extractFromTables(content, seen, seenValues);
  warnings.push(...tableWarnings);

  const tokens = [...fromBlocks, ...fromTables];

  if (!tokens.length) {
    warnings.push('No tokens extracted — ensure the design doc has markdown tables with hex values or CSS variable declarations in code blocks.');
  }

  return {
    tokens,
    css: renderCss(filePath, tokens),
    colorCount: tokens.filter(t => t.category === 'color').length,
    spacingCount: tokens.filter(t => t.category === 'spacing').length,
    typographyCount: tokens.filter(t => t.category === 'typography').length,
    warnings,
  };
}
