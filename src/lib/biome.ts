// Biome, compiled to WASM, running in-Worker. A Durable Object can't shell out to
// the `biome` CLI, so we drive Biome's WASM build via @biomejs/js-api (web
// distribution). The instance is created once per isolate and cached.

import { Biome, Distribution, type Diagnostic } from "@biomejs/js-api";
import { initSync } from "@biomejs/wasm-web";
// Wrangler/esbuild turns this import into a compiled WebAssembly.Module.
import biomeWasm from "@biomejs/wasm-web/biome_wasm_bg.wasm";

let biomePromise: Promise<Biome> | null = null;

async function getBiome(): Promise<Biome> {
  if (!biomePromise) {
    biomePromise = (async () => {
      // js-api's loader only calls `wasm.main()` and never instantiates the module,
      // which fails in workerd. Pre-instantiate the (shared) wasm-web singleton with
      // the bundled module first, then js-api's main() call has a live instance.
      initSync({ module: biomeWasm });
      const biome = await Biome.create({ distribution: Distribution.WEB });
      biome.applyConfiguration({
        formatter: { enabled: true, indentStyle: "space", indentWidth: 2, lineWidth: 100 },
        linter: { enabled: true, rules: { recommended: true } },
        javascript: { formatter: { quoteStyle: "single", semicolons: "always" } },
      });
      return biome;
    })();
  }
  return biomePromise;
}

export interface LintFinding {
  severity: string;
  category: string | null;
  message: string;
  line: number | null;
}

export interface LintReport {
  /** Biome-formatted source (falls back to the input if it couldn't be parsed). */
  formatted: string;
  findings: LintFinding[];
  errorCount: number;
  warningCount: number;
}

const SEVERITY_RANK: Record<string, number> = {
  fatal: 4,
  error: 3,
  warning: 2,
  information: 1,
  hint: 0,
};

function lineFromOffset(content: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, content.length);
  for (let i = 0; i < end; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

function toFinding(d: Diagnostic, content: string): LintFinding {
  // The wasm Diagnostic shape isn't fully typed here; read defensively.
  const raw = d as unknown as {
    severity?: string;
    description?: string;
    category?: string | null;
    location?: { span?: [number, number] | null };
  };
  const span = raw.location?.span ?? null;
  return {
    severity: raw.severity ?? "error",
    category: raw.category ?? null,
    message: raw.description ?? "Unknown issue",
    line: span ? lineFromOffset(content, span[0]) : null,
  };
}

/** Format then lint a single virtual file. Never throws — parse errors surface as findings. */
export async function formatAndLint(code: string, filePath = "Component.tsx"): Promise<LintReport> {
  const biome = await getBiome();

  let formatted = code;
  try {
    const res = biome.formatContent(code, { filePath });
    if (res.content) formatted = res.content;
  } catch {
    formatted = code; // unparseable — keep original; lint will report the syntax error
  }

  let diagnostics: Diagnostic[] = [];
  try {
    diagnostics = biome.lintContent(formatted, { filePath }).diagnostics ?? [];
  } catch (err) {
    return {
      formatted,
      findings: [{ severity: "fatal", category: "parse", message: String(err), line: null }],
      errorCount: 1,
      warningCount: 0,
    };
  }

  const findings = diagnostics.map((d) => toFinding(d, formatted));
  const errorCount = findings.filter((f) => (SEVERITY_RANK[f.severity] ?? 0) >= 3).length;
  const warningCount = findings.filter((f) => (SEVERITY_RANK[f.severity] ?? 0) === 2).length;
  return { formatted, findings, errorCount, warningCount };
}
