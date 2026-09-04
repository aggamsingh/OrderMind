/**
 * principal-auth.ts — proves who is operating the principal console.
 *
 * THE HOLE THIS CLOSES:
 * /api/principal/* read the principal's identity straight out of the request
 * — a query param when listing mandates, a JSON field when revoking. That
 * made every control on that console usable by anyone who knew (or guessed)
 * an email address: revoke a stranger's mandate, or fire their kill switch
 * and stop their agent mid-purchase. The controls were sound; the question
 * of *whose* controls they were had simply never been asked.
 *
 * So the identity now comes from a signed cookie the server issued, never
 * from the request body. That single change is the fix — the rest is
 * plumbing.
 *
 * SCOPE, stated plainly: a shared console password standing in for a real
 * login. A production deployment would put this behind the principal's own
 * identity provider and let them prove *which* principal they are, rather
 * than trusting the one they type in. What matters for the guarantee being
 * demonstrated is that authority is derived server-side from a signed
 * session, not asserted by the caller — and that part is real.
 */

import crypto from "crypto";

const COOKIE_NAME = "ordermind_principal";
/** Sessions are short: this console can stop an agent mid-spend. */
const SESSION_TTL_SECONDS = 60 * 60 * 8;

function getSigningSecret(): string {
  const secret = process.env.MANDATE_SIGNING_SECRET;
  if (!secret) throw new Error("Missing MANDATE_SIGNING_SECRET — required to sign console sessions.");
  return secret;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}
function sign(payload: string): string {
  return b64url(crypto.createHmac("sha256", getSigningSecret()).update(payload).digest());
}

/**
 * Checks the console password. Timing-safe, because a password compared with
 * `===` leaks its length and prefix to anyone patient enough to measure.
 */
export function checkConsolePassword(candidate: string): boolean {
  const expected = process.env.PRINCIPAL_CONSOLE_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(candidate ?? "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function issuePrincipalSession(principal: string): { cookieName: string; value: string; maxAge: number } {
  const payload = b64url(
    JSON.stringify({ principal, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })
  );
  return { cookieName: COOKIE_NAME, value: `${payload}.${sign(payload)}`, maxAge: SESSION_TTL_SECONDS };
}

/**
 * Returns the principal this session belongs to, or null. Signature first —
 * until the HMAC verifies, the principal inside is attacker-supplied text.
 */
export function readPrincipalSession(cookieValue: string | undefined): string | null {
  if (!cookieValue || !cookieValue.includes(".")) return null;
  const [payload, providedSig] = cookieValue.split(".", 2);
  const a = Buffer.from(sign(payload));
  const b = Buffer.from(providedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(fromB64url(payload).toString("utf8")) as { principal?: string; exp?: number };
    if (typeof parsed.principal !== "string" || typeof parsed.exp !== "number") return null;
    if (parsed.exp * 1000 < Date.now()) return null;
    return parsed.principal;
  } catch {
    return null;
  }
}

export const PRINCIPAL_COOKIE = COOKIE_NAME;
