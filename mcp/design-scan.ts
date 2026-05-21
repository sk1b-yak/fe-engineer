// Static design-quality scan via Babel AST. Detects code-level anti-patterns
// that a design-system review should catch: hardcoded values, inline styles,
// oversized components, deeply-nested ternaries, etc.
// Claude then layers visual + architectural judgement on top of these findings.

import { parse } from '@babel/parser';

type Node = any;

export type DesignIssue =
  | 'inline-style'
  | 'hardcoded-color'
  | 'magic-spacing'
  | 'god-component'
  | 'deep-ternary'
  | 'missing-key'
  | 'hardcoded-string-content'
  | 'no-semantic-html';

export interface DesignFinding {
  issue: DesignIssue;
  severity: 'error' | 'warning' | 'info';
  line: number | null;
  detail: string;
  suggestion: string;
}

export interface DesignReport {
  filePath: string;
  componentCount: number;
  jsxElementCount: number;
  inlineStyleCount: number;
  findings: DesignFinding[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

// ── AST helpers ──────────────────────────────────────────────────────────────

const SKIP = new Set(['loc','start','end','range','leadingComments','trailingComments','innerComments','comments']);
const COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgb[a]?\(/;
// Common design-token spacing values (multiples of 4 up to 64px, plus 0).
const TOKEN_SPACING = new Set([0,1,2,4,6,8,10,12,14,16,20,24,28,32,40,48,56,64,72,80,96,128]);
const SPACING_PROPS = new Set(['margin','marginTop','marginRight','marginBottom','marginLeft','padding',
  'paddingTop','paddingRight','paddingBottom','paddingLeft','gap','rowGap','columnGap',
  'top','right','bottom','left','width','height','maxWidth','minWidth','maxHeight','minHeight',
  'borderRadius','borderWidth','fontSize','lineHeight','letterSpacing']);
const LAYOUT_TAGS = new Set(['main','section','article','header','footer','nav','aside','figure','figcaption']);

function walk(node: Node, enter: (n: Node) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const c of node) walk(c, enter); return; }
  if (typeof node.type !== 'string') return;
  enter(node);
  for (const key of Object.keys(node)) {
    if (!SKIP.has(key)) walk(node[key], enter);
  }
}

function jsxName(name: Node): string {
  if (!name) return '';
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') return `${jsxName(name.object)}.${jsxName(name.property)}`;
  return '';
}

function getAttr(opening: Node, name: string): Node | null {
  return (opening?.attributes ?? []).find(
    (a: Node) => a.type === 'JSXAttribute' && a.name?.name === name,
  ) ?? null;
}

/** Recursively count JSX nesting depth of ternary/logical expressions. */
function ternaryDepth(node: Node, depth = 0): number {
  if (!node) return depth;
  if (node.type === 'ConditionalExpression') {
    return Math.max(ternaryDepth(node.consequent, depth + 1), ternaryDepth(node.alternate, depth + 1));
  }
  if (node.type === 'LogicalExpression') return ternaryDepth(node.right, depth + 1);
  return depth;
}

/** Check if a string value looks like a hardcoded colour. */
function isColor(val: string): boolean {
  return COLOR_RE.test(val.trim()) || RGB_RE.test(val.trim().toLowerCase());
}

/** Check if a px/rem value is off-grid (not a standard token multiple). */
function isMagicSpacing(val: string): boolean {
  const px = val.match(/^(\d+(?:\.\d+)?)px$/);
  if (px) {
    const n = parseFloat(px[1]!);
    return !TOKEN_SPACING.has(n);
  }
  return false;
}

// ── Object-expression style prop walker ─────────────────────────────────────

function scanStyleObject(obj: Node, findings: DesignFinding[]): void {
  if (!obj || obj.type !== 'ObjectExpression') return;
  for (const prop of obj.properties ?? []) {
    if (prop.type !== 'ObjectProperty') continue;
    const key = prop.key?.name ?? prop.key?.value ?? '';
    const val = prop.value;
    const line: number | null = prop.loc?.start?.line ?? null;

    if (val?.type === 'StringLiteral') {
      const str: string = val.value;
      if (isColor(str)) {
        findings.push({ issue: 'hardcoded-color', severity: 'warning', line,
          detail: `Inline style '${key}: ${str}' uses a hardcoded colour.`,
          suggestion: 'Reference a CSS variable (--color-*) or design token instead.' });
      } else if (isMagicSpacing(str) && SPACING_PROPS.has(key)) {
        findings.push({ issue: 'magic-spacing', severity: 'info', line,
          detail: `Inline style '${key}: ${str}' is not on the 4px grid.`,
          suggestion: 'Prefer multiples of 4px or a spacing token.' });
      }
    }
    if (val?.type === 'NumericLiteral' && SPACING_PROPS.has(key)) {
      const n: number = val.value;
      if (!TOKEN_SPACING.has(n) && n > 0) {
        findings.push({ issue: 'magic-spacing', severity: 'info', line,
          detail: `Inline style '${key}: ${n}' is not on the 4px grid.`,
          suggestion: 'Prefer multiples of 4px or a spacing token.' });
      }
    }
  }
}

// ── Main scan ────────────────────────────────────────────────────────────────

export function scanDesign(code: string, filePath = 'Component.tsx'): DesignReport {
  let ast: Node;
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties'],
    });
  } catch {
    return { filePath, componentCount: 0, jsxElementCount: 0, inlineStyleCount: 0,
      findings: [], errorCount: 0, warningCount: 0, infoCount: 0 };
  }

  const findings: DesignFinding[] = [];
  let jsxElementCount = 0;
  let inlineStyleCount = 0;
  let componentCount = 0;
  let hasSemanticLayout = false;

  walk(ast, (n) => {
    // Count top-level component definitions
    if (
      (n.type === 'FunctionDeclaration' || n.type === 'ArrowFunctionExpression') &&
      n.id?.name && /^[A-Z]/.test(n.id.name)
    ) componentCount++;

    // JSX elements
    if (n.type === 'JSXElement') {
      jsxElementCount++;
      const opening = n.openingElement;
      const tag = jsxName(opening?.name);
      const lower = tag.toLowerCase();
      const line: number | null = opening?.loc?.start?.line ?? null;

      if (LAYOUT_TAGS.has(lower)) hasSemanticLayout = true;

      // Inline style prop
      const styleProp = getAttr(opening, 'style');
      if (styleProp) {
        inlineStyleCount++;
        findings.push({ issue: 'inline-style', severity: 'warning', line,
          detail: `<${tag}> uses an inline style prop.`,
          suggestion: 'Move styles to a CSS class or design token. Inline styles bypass your design system and can\'t be overridden by themes.' });
        // Dig into the style object for colour/spacing issues
        const expr = styleProp.value?.expression ?? styleProp.value;
        scanStyleObject(expr, findings);
      }

      // Deeply nested ternaries inside JSX
      for (const child of n.children ?? []) {
        if (child.type === 'JSXExpressionContainer') {
          const depth = ternaryDepth(child.expression);
          if (depth >= 2) {
            findings.push({ issue: 'deep-ternary', severity: 'warning', line,
              detail: `JSX contains a ${depth}-level nested ternary — hard to read and maintain.`,
              suggestion: 'Extract branches into named variables or sub-components.' });
          }
        }
      }

      // Array-mapped children missing key
      // (check parent CallExpression .map — done via walk below)

      // Div/span used for layout instead of semantic HTML
      if (lower === 'div') {
        const roleAttr = (opening?.attributes ?? []).find(
          (a: Node) => a.type === 'JSXAttribute' && a.name?.name === 'role',
        );
        if (!roleAttr && !hasSemanticLayout && jsxElementCount > 20) {
          // Only flag once per file, not per div
        }
      }
    }

    // .map() calls without key prop on returned JSX
    if (
      n.type === 'CallExpression' &&
      n.callee?.type === 'MemberExpression' &&
      n.callee.property?.name === 'map'
    ) {
      const cb = n.arguments?.[0];
      const body = cb?.body;
      // Arrow with direct JSX return
      const returnedJSX =
        body?.type === 'JSXElement' ? body :
        body?.type === 'ParenthesizedExpression' ? body.expression :
        body?.body?.find?.((s: Node) => s.type === 'ReturnStatement')?.argument;
      if (returnedJSX?.type === 'JSXElement') {
        const opening = returnedJSX.openingElement;
        const keyProp = (opening?.attributes ?? []).find(
          (a: Node) => a.type === 'JSXAttribute' && a.name?.name === 'key',
        );
        if (!keyProp) {
          findings.push({ issue: 'missing-key', severity: 'error',
            line: returnedJSX.loc?.start?.line ?? null,
            detail: '.map() returns JSX without a key prop.',
            suggestion: 'Add a stable key prop to avoid reconciliation bugs (avoid array index if items reorder).' });
        }
      }
    }
  });

  // God-component heuristic: > 150 JSX elements in one file
  if (jsxElementCount > 150) {
    findings.unshift({ issue: 'god-component', severity: 'warning', line: null,
      detail: `File contains ${jsxElementCount} JSX elements — likely a God Component.`,
      suggestion: 'Split into focused sub-components of < 80 elements each.' });
  }

  // No semantic HTML for layout
  if (jsxElementCount > 10 && !hasSemanticLayout) {
    findings.push({ issue: 'no-semantic-html', severity: 'info', line: null,
      detail: 'No semantic layout elements found (main, section, article, header, footer, nav).',
      suggestion: 'Use semantic HTML to improve accessibility and SEO.' });
  }

  const errorCount = findings.filter(f => f.severity === 'error').length;
  const warningCount = findings.filter(f => f.severity === 'warning').length;
  const infoCount = findings.filter(f => f.severity === 'info').length;
  return { filePath, componentCount, jsxElementCount, inlineStyleCount, findings,
    errorCount, warningCount, infoCount };
}
