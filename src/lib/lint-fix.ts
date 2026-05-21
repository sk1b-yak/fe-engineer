// The lint-and-fix loop: format -> lint -> if issues remain, ask the model to fix
// them and repeat, up to maxPasses. Returns the cleanest code it could produce and
// honestly reports anything still outstanding rather than looping forever.

import { generateText, type LanguageModel } from "ai";
import { formatAndLint, type LintFinding } from "./biome";

export interface LintFixResult {
  code: string;
  clean: boolean;
  passes: number;
  remaining: LintFinding[];
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/);
  return (fence ? fence[1]! : trimmed).trim();
}

function describe(findings: LintFinding[]): string {
  return findings
    .map((f) => {
      const where = f.line ? ` (line ${f.line})` : "";
      const cat = f.category ? ` ${f.category}` : "";
      return `- [${f.severity}]${cat}${where}: ${f.message}`;
    })
    .join("\n");
}

async function repair(
  code: string,
  findings: LintFinding[],
  filePath: string,
  model: LanguageModel,
): Promise<string> {
  const { text } = await generateText({
    model,
    system:
      "You are a senior front-end engineer. Fix ALL of the reported Biome lint/format " +
      "issues in the file. Preserve behavior and public API. Return ONLY the corrected " +
      "file contents — no markdown fences, no commentary.",
    prompt: `File: ${filePath}\n\nIssues to fix:\n${describe(findings)}\n\nCurrent contents:\n${code}`,
  });
  return stripFences(text);
}

export async function lintAndFix(
  initialCode: string,
  filePath: string,
  model: LanguageModel,
  maxPasses = 3,
): Promise<LintFixResult> {
  let report = await formatAndLint(initialCode, filePath);
  let code = report.formatted;
  let passes = 0;

  while (report.errorCount + report.warningCount > 0 && passes < maxPasses) {
    passes++;
    const fixed = await repair(code, report.findings, filePath, model);
    report = await formatAndLint(fixed, filePath);
    code = report.formatted;
  }

  return {
    code,
    clean: report.errorCount + report.warningCount === 0,
    passes,
    remaining: report.findings,
  };
}
