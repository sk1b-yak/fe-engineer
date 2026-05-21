// Sweep a UI directory through the deployed fe-engineer audit service.
// Usage: node scripts/sweep-ui.mjs <dir> [auditUrl]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const dir = process.argv[2];
const AUDIT = process.argv[3] ?? "https://fe-engineer.d4nkcloud.workers.dev/api/audit";
if (!dir) {
  console.error("usage: node scripts/sweep-ui.mjs <dir> [auditUrl]");
  process.exit(1);
}

function walk(d, acc = []) {
  for (const name of readdirSync(d)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(d, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (/\.(tsx|jsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

const files = walk(dir);
console.log(`Auditing ${files.length} files via ${AUDIT}\n`);

let totalInteractive = 0;
let totalErrors = 0;
let totalWarnings = 0;
const flagged = [];

for (const file of files) {
  const code = readFileSync(file, "utf8");
  const rel = relative(dir, file);
  let res;
  try {
    const r = await fetch(AUDIT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, filePath: rel }),
    });
    res = (await r.json()).static;
  } catch (e) {
    console.log(`  ?? ${rel} — request failed: ${e.message}`);
    continue;
  }
  if (!res) continue;
  if (res.parseError) {
    console.log(`  ?? ${rel} — parse error (skipped): ${res.parseError.slice(0, 80)}`);
    continue;
  }
  totalInteractive += res.interactiveCount;
  totalErrors += res.errorCount;
  totalWarnings += res.warningCount;
  if (res.findings.length) {
    flagged.push({ rel, res });
    const tag = res.errorCount ? "✗" : "!";
    console.log(`  ${tag} ${rel}  (interactive=${res.interactiveCount}, errors=${res.errorCount}, warnings=${res.warningCount})`);
    for (const f of res.findings) {
      console.log(`      [${f.severity}] ${f.element} L${f.line} ${f.issue}: ${f.detail}`);
    }
  }
}

console.log(`\n=== SWEEP SUMMARY ===`);
console.log(`files=${files.length}  interactiveElements=${totalInteractive}  errors=${totalErrors}  warnings=${totalWarnings}`);
console.log(`files clean=${files.length - flagged.length}  flagged=${flagged.length}`);
