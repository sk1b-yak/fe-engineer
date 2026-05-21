// Augment the auto-generated Env with secrets managed via `wrangler secret put`.
// These are not in wrangler.jsonc (secrets must not be committed), so wrangler types
// doesn't know about them — declare them here instead.
interface Env {
  /** Set via: wrangler secret put CHAT_API_KEY. If absent, auth is disabled (local dev). */
  CHAT_API_KEY?: string;
}
