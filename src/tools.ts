// The agent's tools. Each one wraps a lib function so the chat model can call it
// (and self-correct from the results).

import { generateText, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { lintAndFix } from "./lib/lint-fix";
import { auditUi } from "./lib/ui-audit";
import { runtimeAudit } from "./lib/runtime-audit";

const FE_SYSTEM =
  "You are a senior front-end engineer. Write modern, idiomatic React + TypeScript " +
  "(function components, hooks, accessible markup). Every interactive element must have a " +
  "real, wired handler — never leave an empty onClick. Return ONLY the file contents, no " +
  "markdown fences, no commentary.";

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/);
  return (fence ? fence[1]! : trimmed).trim();
}

export function makeTools({ model, env }: { model: LanguageModel; env: Env }) {
  return {
    generate_component: tool({
      description:
        "Generate a React/TSX component (or any frontend file) from a spec, then lint-and-fix " +
        "it with Biome so the returned code is clean. Use whenever the user asks to create, " +
        "build, or write a component/page.",
      inputSchema: z.object({
        spec: z.string().describe("What to build: desired props, behavior, constraints."),
        filePath: z
          .string()
          .optional()
          .describe("Virtual filename, e.g. 'Button.tsx' — controls how Biome parses it."),
      }),
      execute: async ({ spec, filePath }) => {
        const fp = filePath ?? "Component.tsx";
        const { text } = await generateText({
          model,
          system: FE_SYSTEM,
          prompt: `Write the complete contents of ${fp} for this spec:\n\n${spec}`,
        });
        const draft = stripFences(text);
        const result = await lintAndFix(draft, fp, model);
        return { filePath: fp, ...result };
      },
    }),

    lint_fix: tool({
      description:
        "Lint and auto-fix a piece of frontend code with Biome (format + lint, self-correcting). " +
        "Use when the user pastes code to clean up.",
      inputSchema: z.object({
        code: z.string().describe("The source to lint and fix."),
        filePath: z.string().optional(),
      }),
      execute: async ({ code, filePath }) => {
        const fp = filePath ?? "Component.tsx";
        return lintAndFix(code, fp, model);
      },
    }),

    audit_ui: tool({
      description:
        "Audit a frontend file's wiring: confirm every button/handler does something, and flag " +
        "no-op handlers, handlers referencing undefined symbols, and undefined components. " +
        "Optionally also click every button on a live page if a URL is provided.",
      inputSchema: z.object({
        code: z.string().describe("Component source to audit statically."),
        filePath: z.string().optional(),
        url: z
          .string()
          .optional()
          .describe("Optional live page URL to click-test every button (needs Browser Rendering)."),
      }),
      execute: async ({ code, filePath, url }) => {
        const fp = filePath ?? "Component.tsx";
        const staticReport = auditUi(code, fp);
        const runtime = url
          ? await runtimeAudit(env.BROWSER, url)
          : { skipped: true as const, reason: "No url provided — static audit only" };
        return { static: staticReport, runtime };
      },
    }),
  };
}
