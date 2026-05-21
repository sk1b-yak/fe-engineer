import { routeAgentRequest } from "agents";
import { formatAndLint } from "./lib/biome";
import { auditUi } from "./lib/ui-audit";
import { runtimeAudit } from "./lib/runtime-audit";

export { FeEngineer } from "./agent";

const JSON_CORS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Diagnostic: exercises the Biome WASM init + the static audit in the live
    // runtime, with no Workers AI dependency. Useful as a health check.
    if (url.pathname === "/_selftest") {
      const lint = await formatAndLint("const x=1 ;let  y=2\nexport const z=x+y\n", "selftest.ts");
      const audit = auditUi(
        "export const A = () => <button onClick={() => {}}>dead</button>;",
        "A.tsx",
      );
      return Response.json({ ok: true, biomeReady: true, lint, audit });
    }

    // Static UI wiring audit over HTTP (no Workers AI, no cost). Pass an optional
    // `url` to also click-test every button via Browser Rendering.
    if (url.pathname === "/api/audit") {
      if (request.method === "OPTIONS") return new Response(null, { headers: JSON_CORS });
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "POST { code, filePath?, url? }" }), { status: 405, headers: JSON_CORS });
      }
      const body = (await request.json().catch(() => null)) as
        | { code?: string; filePath?: string; url?: string }
        | null;
      if (!body?.code) {
        return new Response(JSON.stringify({ error: "missing 'code'" }), { status: 400, headers: JSON_CORS });
      }
      const staticReport = auditUi(body.code, body.filePath ?? "Component.tsx");
      const runtime = body.url ? await runtimeAudit(env.BROWSER, body.url) : undefined;
      return new Response(JSON.stringify({ static: staticReport, runtime }), { headers: JSON_CORS });
    }

    return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
