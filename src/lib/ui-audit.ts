// Static UI wiring audit. Parses a TSX/JSX file and checks that every interactive
// element actually does something: each button/handler must be wired to a real,
// non-empty function, handlers must reference defined symbols, and JSX components
// must be imported/defined. Pure JS (Babel parser) so it runs in a Worker.

import { parse } from "@babel/parser";

// AST nodes are walked structurally; `any` keeps the walker readable.
type Node = any;

export type AuditIssue =
  | "missing-handler"
  | "no-op-handler"
  | "undefined-handler"
  | "undefined-component"
  | "string-handler";

export interface AuditFinding {
  element: string;
  line: number | null;
  issue: AuditIssue;
  severity: "error" | "warning";
  detail: string;
}

export interface UiAuditReport {
  ok: boolean;
  parseError?: string;
  interactiveCount: number;
  errorCount: number;
  warningCount: number;
  findings: AuditFinding[];
}

const GLOBALS = new Set([
  "console", "window", "document", "navigator", "localStorage", "sessionStorage",
  "fetch", "setTimeout", "setInterval", "clearTimeout", "clearInterval",
  "requestAnimationFrame", "cancelAnimationFrame", "alert", "confirm", "prompt",
  "Math", "JSON", "Object", "Array", "String", "Number", "Boolean", "Date",
  "Promise", "Map", "Set", "Symbol", "RegExp", "Error", "history", "location",
  "URL", "URLSearchParams", "FormData", "Blob", "structuredClone", "this",
  "Fragment", "React",
]);

const SKIP_KEYS = new Set([
  "loc", "start", "end", "range", "leadingComments", "trailingComments", "innerComments", "comments",
]);

function jsxName(name: Node): string {
  if (!name) return "";
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression") return `${jsxName(name.object)}.${jsxName(name.property)}`;
  if (name.type === "JSXNamespacedName") return `${name.namespace.name}:${name.name.name}`;
  return "";
}

function rootObjectName(member: Node): string | null {
  let cur = member;
  while (cur && cur.type === "MemberExpression") cur = cur.object;
  if (cur && cur.type === "Identifier") return cur.name;
  if (cur && cur.type === "ThisExpression") return "this";
  return null;
}

function collectPatternNames(node: Node, out: Set<string>): void {
  if (!node) return;
  switch (node.type) {
    case "Identifier": out.add(node.name); break;
    case "ObjectPattern":
      for (const p of node.properties) {
        if (p.type === "ObjectProperty") collectPatternNames(p.value, out);
        else if (p.type === "RestElement") collectPatternNames(p.argument, out);
      }
      break;
    case "ArrayPattern":
      for (const el of node.elements) if (el) collectPatternNames(el, out);
      break;
    case "AssignmentPattern": collectPatternNames(node.left, out); break;
    case "RestElement": collectPatternNames(node.argument, out); break;
  }
}

function walk(node: Node, enter: (n: Node, ancestors: string[]) => void, ancestors: string[] = []): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, enter, ancestors);
    return;
  }
  if (typeof node.type !== "string") return;

  enter(node, ancestors);

  let next = ancestors;
  if (node.type === "JSXElement") {
    const tag = jsxName(node.openingElement?.name);
    if (tag) next = [...ancestors, tag.toLowerCase()];
  }
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    walk(node[key], enter, next);
  }
}

function collectBindings(ast: Node): Set<string> {
  const names = new Set<string>();
  walk(ast, (n) => {
    switch (n.type) {
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
      case "ImportSpecifier":
        if (n.local?.name) names.add(n.local.name);
        break;
      case "FunctionDeclaration":
      case "ClassDeclaration":
        if (n.id?.name) names.add(n.id.name);
        if (n.params) for (const p of n.params) collectPatternNames(p, names);
        break;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (n.params) for (const p of n.params) collectPatternNames(p, names);
        break;
      case "VariableDeclarator":
        collectPatternNames(n.id, names);
        break;
    }
  });
  return names;
}

function attrs(opening: Node): Node[] {
  return (opening.attributes ?? []).filter((a: Node) => a.type === "JSXAttribute");
}
function hasSpread(opening: Node): boolean {
  return (opening.attributes ?? []).some((a: Node) => a.type === "JSXSpreadAttribute");
}
function getAttr(opening: Node, name: string): Node | null {
  return attrs(opening).find((a: Node) => a.name?.type === "JSXIdentifier" && a.name.name === name) ?? null;
}
function attrStringValue(attr: Node | null): string | null {
  if (!attr || !attr.value) return null;
  if (attr.value.type === "StringLiteral") return attr.value.value;
  if (attr.value.type === "JSXExpressionContainer" && attr.value.expression?.type === "StringLiteral") {
    return attr.value.expression.value;
  }
  return null;
}

function evalHandler(attrName: string, value: Node, isKnown: (n: string) => boolean): Omit<AuditFinding, "element" | "line"> | null {
  if (value == null) return { issue: "no-op-handler", severity: "error", detail: `${attrName} has no value` };
  if (value.type === "StringLiteral") {
    return { issue: "string-handler", severity: "warning", detail: `${attrName} is a string, not a function` };
  }
  if (value.type !== "JSXExpressionContainer") return null;

  const e = value.expression;
  if (!e || e.type === "JSXEmptyExpression") {
    return { issue: "no-op-handler", severity: "error", detail: `${attrName} expression is empty` };
  }
  if (e.type === "ArrowFunctionExpression" || e.type === "FunctionExpression") {
    const body = e.body;
    if (body.type === "BlockStatement" && body.body.length === 0) {
      return { issue: "no-op-handler", severity: "error", detail: `${attrName} handler body is empty` };
    }
    if (body.type === "Identifier" && body.name === "undefined") {
      return { issue: "no-op-handler", severity: "error", detail: `${attrName} handler does nothing (returns undefined)` };
    }
    if (body.type === "NullLiteral") {
      return { issue: "no-op-handler", severity: "error", detail: `${attrName} handler does nothing (returns null)` };
    }
    return null;
  }
  if (e.type === "Identifier") {
    return isKnown(e.name)
      ? null
      : { issue: "undefined-handler", severity: "error", detail: `${attrName}={${e.name}} — '${e.name}' is not defined or imported` };
  }
  if (e.type === "MemberExpression") {
    const root = rootObjectName(e);
    return !root || isKnown(root)
      ? null
      : { issue: "undefined-handler", severity: "error", detail: `${attrName} references '${root}' which is not defined or imported` };
  }
  // CallExpression / Conditional / Logical / etc. — assume it does something.
  return null;
}

export function auditUi(code: string, filePath = "Component.tsx"): UiAuditReport {
  let ast: Node;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx", "decorators-legacy", "classProperties"],
    });
  } catch (err) {
    return {
      ok: false,
      parseError: err instanceof Error ? err.message : String(err),
      interactiveCount: 0,
      errorCount: 0,
      warningCount: 0,
      findings: [],
    };
  }

  const bindings = collectBindings(ast);
  const isKnown = (n: string) => bindings.has(n) || GLOBALS.has(n);
  const findings: AuditFinding[] = [];
  let interactiveCount = 0;

  walk(ast, (n, ancestors) => {
    if (n.type !== "JSXElement") return;
    const opening = n.openingElement;
    const tag = jsxName(opening?.name);
    if (!tag) return;
    const lower = tag.toLowerCase();
    const line: number | null = opening.loc?.start?.line ?? null;

    // Undefined custom component (capitalized or dotted JSX name).
    const root = tag.split(".")[0]!;
    if (/^[A-Z]/.test(root) && !isKnown(root)) {
      findings.push({
        element: `<${tag}>`,
        line,
        issue: "undefined-component",
        severity: "error",
        detail: `Component '${root}' is used but not imported or defined`,
      });
    }

    const handlerAttrs = attrs(opening).filter(
      (a: Node) => a.name?.type === "JSXIdentifier" && /^on[A-Z]/.test(a.name.name),
    );
    const roleButton = attrStringValue(getAttr(opening, "role")) === "button";
    const inputType = (attrStringValue(getAttr(opening, "type")) ?? "").toLowerCase();
    const isInteractive =
      lower === "button" ||
      (lower === "a" && getAttr(opening, "href") !== null) ||
      (lower === "input" && ["submit", "button", "reset"].includes(inputType)) ||
      roleButton ||
      handlerAttrs.length > 0;

    if (isInteractive) interactiveCount++;

    // A <button> with no handler that isn't a form-submit button does nothing.
    if (lower === "button" && handlerAttrs.length === 0 && !hasSpread(opening)) {
      const isSubmit = inputType === "submit" || ancestors.includes("form");
      if (!isSubmit) {
        findings.push({
          element: `<${tag}>`,
          line,
          issue: "missing-handler",
          severity: "warning",
          detail: "button has no onClick handler and is not a form submit button",
        });
      }
    }

    for (const a of handlerAttrs) {
      const res = evalHandler(a.name.name, a.value, isKnown);
      if (res) findings.push({ element: `<${tag}>`, line, ...res });
    }
  });

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  return { ok: errorCount === 0, interactiveCount, errorCount, warningCount, findings };
}
