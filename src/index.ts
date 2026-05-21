import { routeAgentRequest } from 'agents';
import { authorized } from './lib/auth';
import { formatAndLint } from './lib/biome';
import { runtimeAudit } from './lib/runtime-audit';
import { auditUi } from './lib/ui-audit';

export { FeEngineer } from './agent';

const JSON_CORS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized — set Authorization: Bearer <CHAT_API_KEY> or ?key=<KEY>' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check: exercises Biome WASM + static audit, no Workers AI, no auth required.
    if (url.pathname === '/_selftest') {
      const lint = await formatAndLint("const x=1 ;let  y=2\nexport const z=x+y\n", 'selftest.ts');
      const audit = auditUi(
        'export const A = () => <button onClick={() => {}}>dead</button>;',
        'A.tsx',
      );
      return Response.json({ ok: true, biomeReady: true, lint, audit });
    }

    // Static UI wiring audit (no Workers AI). Auth required.
    if (url.pathname === '/api/audit') {
      if (request.method === 'OPTIONS') return new Response(null, { headers: JSON_CORS });
      if (!authorized(request, env)) return unauthorized();
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'POST { code, filePath?, url? }' }), { status: 405, headers: JSON_CORS });
      }
      const body = (await request.json().catch(() => null)) as
        | { code?: string; filePath?: string; url?: string }
        | null;
      if (!body?.code) {
        return new Response(JSON.stringify({ error: "missing 'code'" }), { status: 400, headers: JSON_CORS });
      }
      const staticReport = auditUi(body.code, body.filePath ?? 'Component.tsx');
      const runtime = body.url ? await runtimeAudit(env.BROWSER, body.url) : undefined;
      return new Response(JSON.stringify({ static: staticReport, runtime }), { headers: JSON_CORS });
    }

    // Agent WebSocket + HTTP routes — auth required (key via ?key= for WS, Bearer for HTTP).
    if (url.pathname.startsWith('/agents/')) {
      if (!authorized(request, env)) return unauthorized();
    }

    return (await routeAgentRequest(request, env)) ?? new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
