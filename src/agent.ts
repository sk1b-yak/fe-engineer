// FeEngineer — a chat agent that acts as a front-end engineer. It generates/edits
// React code with a built-in Biome lint-and-fix loop, and audits UI wiring (every
// button must do something). Powered by Workers AI (qwen2.5-coder), no API keys.

import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type LanguageModel,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { makeTools } from "./tools";

const MODEL = "@cf/qwen/qwen2.5-coder-32b-instruct";

const SYSTEM = `You are "FE Engineer", a meticulous senior front-end engineer.

You have three tools:
- generate_component: build a React/TSX file from a spec; it is auto-linted and fixed with Biome before you see it.
- lint_fix: clean up code the user pasted.
- audit_ui: verify a component's wiring — that every button/handler actually does something, with no no-op or undefined handlers, and no undefined components. Pass a url to also click every button on a live page.

Rules:
- When asked to create/build/write UI, call generate_component and return the resulting code. If it comes back not clean, tell the user what remains.
- When asked to review/check/verify a UI or "make sure the buttons work", call audit_ui and summarize findings clearly (which buttons are wired, which aren't, and why).
- Never hand back code with an empty or placeholder handler.`;

export class FeEngineer extends AIChatAgent<Env> {
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Response | undefined> {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const model = workersai(MODEL) as LanguageModel;
    const tools = makeTools({ model, env: this.env });

    const result = streamText({
      model,
      system: SYSTEM,
      messages: await convertToModelMessages(this.messages),
      tools,
      stopWhen: stepCountIs(6),
      abortSignal: options?.abortSignal,
      // AI SDK infers a concrete ToolSet from `tools`; the base class hands us the
      // generic callback, so bridge the two.
      onFinish: onFinish as unknown as StreamTextOnFinishCallback<typeof tools>,
    });

    return result.toUIMessageStreamResponse();
  }
}
