/**
 * Returns true if the request carries a valid CHAT_API_KEY credential.
 * Auth is disabled when the secret is not set (local dev / wrangler dev).
 *
 * Two acceptance paths:
 *  - HTTP:      Authorization: Bearer <KEY>
 *  - WebSocket: ?key=<KEY>  (browsers can't set custom headers on WS upgrade)
 */
export function authorized(request: Request, env: Env): boolean {
  if (!env.CHAT_API_KEY) return true; // auth disabled locally

  const authHeader = request.headers.get('Authorization');
  if (authHeader === `Bearer ${env.CHAT_API_KEY}`) return true;

  const key = new URL(request.url).searchParams.get('key');
  if (key === env.CHAT_API_KEY) return true;

  return false;
}
