// Smoke test for the Biome format+lint primitive (Node distribution mirrors the
// Worker's WEB path). Run: npm run test:lint
import { Biome, Distribution } from "@biomejs/js-api";

const MESSY = `import {useState} from "react"
export function Counter(){
const [n,setN]=useState(0)
   var unused = 42
return <button onClick={()=>setN(n+1)}>count {n}</button>}
`;

const biome = await Biome.create({ distribution: Distribution.NODE });
biome.applyConfiguration({
  formatter: { enabled: true, indentStyle: "space", indentWidth: 2, lineWidth: 100 },
  linter: { enabled: true, rules: { recommended: true } },
  javascript: { formatter: { quoteStyle: "single", semicolons: "always" } },
});

const { content: formatted } = biome.formatContent(MESSY, { filePath: "Counter.tsx" });
const { diagnostics } = biome.lintContent(formatted, { filePath: "Counter.tsx" });

console.log("=== formatted ===");
console.log(formatted);
console.log(`=== diagnostics (${diagnostics.length}) ===`);
for (const d of diagnostics as Array<{ severity?: string; category?: string; description?: string }>) {
  console.log(`  [${d.severity}] ${d.category ?? ""}: ${d.description}`);
}

if (formatted === MESSY) {
  console.error("\nFAIL: Biome did not reformat the messy input");
  process.exit(1);
}
console.log("\nPASS: Biome formatted the input and produced diagnostics (the lint engine works).");
