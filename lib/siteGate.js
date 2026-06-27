// Shared site-password gate helpers.
// Works in both the Edge runtime (middleware) and Node runtime (route handler)
// via the Web Crypto API (globalThis.crypto.subtle), available in both.

export const GATE_COOKIE = 'og_gate';

// Derive an opaque cookie token from the shared password.
// The token is a SHA-256 hash with a fixed app salt — it is not reversible to
// the password, and an attacker who does not know the password cannot forge it.
export async function gateToken(password) {
  const data = new TextEncoder().encode(`og-site-gate:v1:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
