// Smoke test for the static UI wiring audit. Run: npm run test:audit
import { readFileSync } from "node:fs";
import { auditUi } from "../src/lib/ui-audit.ts";

const BAD = `
import { useState } from "react";
export function Panel() {
  const [on, setOn] = useState(false);
  return (
    <div>
      <button onClick={() => setOn(!on)}>Toggle</button>      {/* wired: ok */}
      <button onClick={() => {}}>Dead</button>                {/* no-op */}
      <button onClick={handleMissing}>Ghost</button>          {/* undefined handler */}
      <button>Bare</button>                                   {/* missing handler */}
      <FancyThing onClick={() => setOn(true)} />              {/* undefined component */}
    </div>
  );
}
`;

const GOOD = `
import { useState } from "react";
import { Icon } from "./Icon";
export function Panel() {
  const [on, setOn] = useState(false);
  const reset = () => setOn(false);
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <button onClick={() => setOn(!on)}><Icon /> Toggle</button>
      <button onClick={reset}>Reset</button>
      <button type="submit">Save</button>
    </form>
  );
}
`;

function show(label: string, code: string) {
  const r = auditUi(code, `${label}.tsx`);
  console.log(`\n=== ${label} ===`);
  console.log(`interactive=${r.interactiveCount} errors=${r.errorCount} warnings=${r.warningCount} ok=${r.ok}`);
  for (const f of r.findings) {
    console.log(`  [${f.severity}] ${f.element} (line ${f.line}) ${f.issue}: ${f.detail}`);
  }
}

show("BAD", BAD);
show("GOOD", GOOD);

// Optional: audit the real HyperMap TradingChart if present.
const HYPERMAP = "C:/Users/saqib/D4NKCLOUD/HyperMap/.claude/worktrees/wt-ae-frontend/src/components/TradingChart.tsx";
try {
  const code = readFileSync(HYPERMAP, "utf8");
  show("HyperMap/TradingChart", code);
} catch {
  console.log("\n(HyperMap TradingChart not found — skipping live-file audit)");
}

// Assertions: BAD must surface the three error kinds; GOOD must be clean.
const bad = auditUi(BAD, "BAD.tsx");
const good = auditUi(GOOD, "GOOD.tsx");
const kinds = new Set(bad.findings.map((f) => f.issue));
const expect = ["no-op-handler", "undefined-handler", "undefined-component", "missing-handler"];
const missing = expect.filter((k) => !kinds.has(k as never));
if (missing.length) {
  console.error(`\nFAIL: BAD audit missed: ${missing.join(", ")}`);
  process.exit(1);
}
if (!good.ok) {
  console.error(`\nFAIL: GOOD audit should be clean but reported ${good.errorCount} errors`);
  process.exit(1);
}
console.log("\nPASS: audit detects no-op/undefined/missing/undefined-component and clears wired UI.");
