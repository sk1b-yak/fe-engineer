// Static accessibility audit via Babel AST. Detects issues that can be
// confirmed without a browser: missing alt text, non-semantic interactives,
// unlabelled inputs, unadorned SVGs, etc.

import { parse } from '@babel/parser';

type Node = any;

export type A11yIssue =
  | 'img-missing-alt'
  | 'img-empty-alt'
  | 'input-no-label'
  | 'interactive-no-role'
  | 'role-button-no-tabindex'
  | 'anchor-no-href'
  | 'svg-not-hidden'
  | 'button-icon-only';

export interface A11yFinding {
  element: string;
  line: number | null;
  issue: A11yIssue;
  severity: 'error' | 'warning';
  detail: string;
  wcag?: string;
}

export interface A11yReport {
  ok: boolean;
  parseError?: string;
  errorCount: number;
  warningCount: number;
  findings: A11yFinding[];
}

// ── AST helpers ─────────────────────────────────────────────────────────────

const SKIP = new Set(['loc','start','end','range','leadingComments','trailingComments','innerComments','comments']);

function jsxName(name: Node): string {
  if (!name) return '';
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') return `${jsxName(name.object)}.${jsxName(name.property)}`;
  return '';
}

function walk(node: Node, enter: (n: Node) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const c of node) walk(c, enter); return; }
  if (typeof node.type !== 'string') return;
  enter(node);
  for (const key of Object.keys(node)) {
    if (!SKIP.has(key)) walk(node[key], enter);
  }
}

function attrs(opening: Node): Node[] {
  return (opening?.attributes ?? []).filter((a: Node) => a.type === 'JSXAttribute');
}

function hasSpread(opening: Node): boolean {
  return (opening?.attributes ?? []).some((a: Node) => a.type === 'JSXSpreadAttribute');
}

function getAttr(opening: Node, name: string): Node | null {
  return attrs(opening).find((a: Node) => a.name?.name === name) ?? null;
}

function attrStringValue(attr: Node | null): string | null {
  if (!attr?.value) return null;
  if (attr.value.type === 'StringLiteral') return attr.value.value;
  if (attr.value.type === 'JSXExpressionContainer') {
    const e = attr.value.expression;
    if (e?.type === 'StringLiteral') return e.value;
    if (e?.type === 'TemplateLiteral' && e.quasis.length === 1) return e.quasis[0]?.value?.cooked ?? null;
  }
  return null;
}

function attrPresent(opening: Node, name: string): boolean {
  return getAttr(opening, name) !== null;
}

function attrTruthy(opening: Node, name: string): boolean {
  const a = getAttr(opening, name);
  if (!a) return false;
  if (a.value === null) return true; // bare attribute, e.g. aria-hidden
  const v = attrStringValue(a);
  if (v !== null) return v.length > 0;
  // JSXExpressionContainer with a real expression — assume truthy
  if (a.value?.type === 'JSXExpressionContainer') {
    const e = a.value.expression;
    if (!e || e.type === 'JSXEmptyExpression') return false;
    if (e.type === 'BooleanLiteral') return e.value;
    return true;
  }
  return false;
}

/** Does a JSXElement have any text-like children? */
function hasTextChildren(node: Node): boolean {
  for (const child of node.children ?? []) {
    if (child.type === 'JSXText' && child.value.trim()) return true;
    if (child.type === 'JSXExpressionContainer') {
      const e = child.expression;
      if (e && e.type !== 'JSXEmptyExpression') return true;
    }
  }
  return false;
}

// ── Main audit ───────────────────────────────────────────────────────────────

export function auditA11y(code: string, filePath = 'Component.tsx'): A11yReport {
  let ast: Node;
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties'],
    });
  } catch (err) {
    return { ok: false, parseError: String(err), errorCount: 0, warningCount: 0, findings: [] };
  }

  const findings: A11yFinding[] = [];

  walk(ast, (n) => {
    if (n.type !== 'JSXElement') return;
    const opening = n.openingElement;
    const tag = jsxName(opening?.name);
    if (!tag) return;
    const lower = tag.toLowerCase();
    const line: number | null = opening?.loc?.start?.line ?? null;

    // <img> — must have alt
    if (lower === 'img') {
      const alt = getAttr(opening, 'alt');
      if (!alt && !hasSpread(opening)) {
        findings.push({ element: '<img>', line, issue: 'img-missing-alt', severity: 'error',
          detail: 'img element is missing an alt attribute.', wcag: '1.1.1' });
      }
      return;
    }

    // <svg> — should be aria-hidden or have aria-label/title
    if (lower === 'svg') {
      const hidden = attrTruthy(opening, 'aria-hidden');
      const labelled = attrTruthy(opening, 'aria-label') || attrPresent(opening, 'aria-labelledby');
      if (!hidden && !labelled) {
        findings.push({ element: '<svg>', line, issue: 'svg-not-hidden', severity: 'warning',
          detail: 'SVG has no aria-hidden="true" or aria-label. Decorative SVGs must be hidden; informative ones need a label.',
          wcag: '1.1.1' });
      }
      return;
    }

    // <a> — missing href and no role/onClick compensation
    if (lower === 'a') {
      const hasHref = attrPresent(opening, 'href');
      const hasRole = attrTruthy(opening, 'role');
      const hasClick = attrPresent(opening, 'onClick');
      if (!hasHref && !hasRole && hasClick) {
        findings.push({ element: '<a>', line, issue: 'anchor-no-href', severity: 'warning',
          detail: '<a onClick> without href acts as a button; use <button> or add role="button" + tabIndex={0}.',
          wcag: '4.1.2' });
      }
      return;
    }

    // <input> — needs accessible label
    if (lower === 'input') {
      const type = (attrStringValue(getAttr(opening, 'type')) ?? 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return;
      const hasLabel = attrTruthy(opening, 'aria-label')
        || attrPresent(opening, 'aria-labelledby')
        || attrPresent(opening, 'id'); // pairing with <label htmlFor> requires cross-node analysis; id is a proxy
      if (!hasLabel && !hasSpread(opening)) {
        findings.push({ element: `<input type="${type}">`, line, issue: 'input-no-label', severity: 'error',
          detail: 'Input has no aria-label or aria-labelledby. Pair it with a <label htmlFor> or add aria-label.',
          wcag: '1.3.1' });
      }
      return;
    }

    // <button> — icon-only (no text children, no aria-label)
    if (lower === 'button') {
      const hasAriaLabel = attrTruthy(opening, 'aria-label') || attrPresent(opening, 'aria-labelledby');
      const hasText = hasTextChildren(n);
      if (!hasAriaLabel && !hasText && !hasSpread(opening)) {
        findings.push({ element: '<button>', line, issue: 'button-icon-only', severity: 'error',
          detail: 'Button appears to have no accessible name. Add aria-label or visible text.',
          wcag: '4.1.2' });
      }
      return;
    }

    // Non-semantic elements with onClick — need role + tabIndex
    if (['div', 'span', 'li', 'td', 'p'].includes(lower)) {
      const hasClick = attrPresent(opening, 'onClick');
      if (!hasClick) return;

      const role = attrStringValue(getAttr(opening, 'role'));
      if (!role) {
        findings.push({ element: `<${lower}>`, line, issue: 'interactive-no-role', severity: 'error',
          detail: `<${lower} onClick> has no role. Add role="button" (or appropriate role) + tabIndex={0}.`,
          wcag: '4.1.2' });
        return;
      }
      // Has role — check tabIndex for keyboard accessibility
      if (['button','link','menuitem','option','tab'].includes(role)) {
        const hasTab = attrPresent(opening, 'tabIndex');
        if (!hasTab) {
          findings.push({ element: `<${lower} role="${role}">`, line, issue: 'role-button-no-tabindex', severity: 'error',
            detail: `<${lower} role="${role}"> is missing tabIndex={0}. Keyboard users can't reach it.`,
            wcag: '2.1.1' });
        }
      }
    }
  });

  const errorCount = findings.filter(f => f.severity === 'error').length;
  const warningCount = findings.filter(f => f.severity === 'warning').length;
  return { ok: errorCount === 0, errorCount, warningCount, findings };
}
