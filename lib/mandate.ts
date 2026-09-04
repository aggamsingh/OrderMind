/**
 * mandate.ts — spend mandates for agent-to-agent commerce.
 *
 * THE PROBLEM THIS SOLVES:
 * lib/guardrails.ts protects a *human* customer from this merchant's own
 * agent (is the total under the cap? did a human actually confirm?). But the
 * moment the buyer is itself an AI, there is a second, symmetric trust problem
 * the merchant cap cannot answer:
 *
 *   "This buyer agent says it wants to spend ₹4,000. Is it actually
 *    *allowed* to? By whom? Up to how much? Until when?"
 *
 * A merchant that just takes the money is exactly the merchant an AI buyer
 * should not be transactable with — a runaway agent loop would drain its
 * principal's account and the merchant would happily process every order.
 *
 * A spend mandate is the buyer's answer: a signed statement from the human
 * (the "principal") delegating bounded authority to their agent — at most
 * this much, for this purpose, until this time, once. This mirrors the
 * mandate concept the agent-payment protocols are converging on (AP2, UAP,
 * ACP) — deliberately, so this is one implementation of an emerging idea
 * rather than a private invention nobody else could interoperate with.
 *
 * THE RULE, same spirit as guardrails.ts:
 * The merchant NEVER trusts what a buyer agent *claims* about its own
 * authority. It verifies the signature itself, re-reads the limits from the
 * verified payload, and enforces them server-side. A buyer agent asserting
 * "my human approved this" in a request body is worth exactly nothing.
 *
 * Signing is HMAC-SHA256 with a shared secret, which is the right shape for
 * a test-mode integration: the buyer's issuer and the merchant share a
 * secret out of band. A production deployment would swap this for
 * asymmetric signatures (the principal's wallet signs, the merchant
 * verifies against a public key) — the verify/enforce split here is
 * deliberately written so that swap is a change inside this file only.
 */

import crypto from "crypto";

export type SpendMandate = {
  /** The autonomous buyer this mandate was granted to. */
  buyer_agent_id: string;
  /** The human (or org) delegating spend authority. */
  principal: string;
  /** Hard ceiling for the whole order, in paise. Never exceeded, ever. */
  max_amount_paise: number;
  currency: "INR";
  /** What the principal authorised this spend *for* — carried into the audit trail. */
  purpose: string;
  issued_at: string;
  expires_at: string;
  /** Single-use marker; replay is rejected (see isMandateReplayed in the agent route). */
  nonce: string;
};

export type MandateVerification =
  | { valid: true; mandate: SpendMandate }
  | { valid: false; reason: string; code: MandateFailureCode };

export type MandateFailureCode =
  | "malformed"
  | "bad_signature"
  | "expired"
  | "not_yet_valid"
  | "unsupported_currency"
  | "invalid_amount";

function getSigningSecret(): string {
  const secret = process.env.MANDATE_SIGNING_SECRET;
  if (!secret) {
    throw new Error(
      "Missing MANDATE_SIGNING_SECRET in .env.local — required to verify buyer-agent spend mandates."
    );
  }
  return secret;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payloadSegment: string): string {
  return b64url(crypto.createHmac("sha256", getSigningSecret()).update(payloadSegment).digest());
}

/**
 * Issues a signed mandate. In a real deployment this happens on the BUYER's
 * side (their principal authorises their agent) — it lives here only so the
 * demo buyer agent in scripts/buyer-agent.ts can mint the mandates it
 * presents. The merchant's trust path is verifyMandate() alone; it never
 * calls this.
 */
export function issueMandate(
  params: Omit<SpendMandate, "issued_at" | "expires_at" | "nonce" | "currency"> & {
    ttlSeconds?: number;
  }
): { token: string; mandate: SpendMandate } {
  const now = new Date();
  const mandate: SpendMandate = {
    buyer_agent_id: params.buyer_agent_id,
    principal: params.principal,
    max_amount_paise: params.max_amount_paise,
    currency: "INR",
    purpose: params.purpose,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + (params.ttlSeconds ?? 900) * 1000).toISOString(),
    nonce: crypto.randomUUID(),
  };

  const payloadSegment = b64url(JSON.stringify(mandate));
  return { token: `${payloadSegment}.${sign(payloadSegment)}`, mandate };
}

/**
 * Verifies a mandate token presented by a buyer agent. Signature first, then
 * structure, then time bounds — a tampered payload must never reach the
 * amount checks, since its numbers are attacker-controlled until the HMAC
 * says otherwise.
 */
export function verifyMandate(token: string): MandateVerification {
  if (typeof token !== "string" || !token.includes(".")) {
    return { valid: false, code: "malformed", reason: "Mandate token is not a signed payload." };
  }

  const [payloadSegment, providedSignature] = token.split(".", 2);
  if (!payloadSegment || !providedSignature) {
    return { valid: false, code: "malformed", reason: "Mandate token is missing a payload or signature." };
  }

  const expected = sign(payloadSegment);
  const a = Buffer.from(expected);
  const b = Buffer.from(providedSignature);
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return {
      valid: false,
      code: "bad_signature",
      reason: "Mandate signature does not verify — the mandate was not issued by a trusted principal, or it was altered in transit.",
    };
  }

  let mandate: SpendMandate;
  try {
    mandate = JSON.parse(fromB64url(payloadSegment).toString("utf8")) as SpendMandate;
  } catch {
    return { valid: false, code: "malformed", reason: "Mandate payload is not valid JSON." };
  }

  if (
    typeof mandate.buyer_agent_id !== "string" ||
    typeof mandate.principal !== "string" ||
    typeof mandate.purpose !== "string" ||
    typeof mandate.nonce !== "string" ||
    typeof mandate.max_amount_paise !== "number"
  ) {
    return { valid: false, code: "malformed", reason: "Mandate payload is missing required fields." };
  }

  if (mandate.currency !== "INR") {
    return {
      valid: false,
      code: "unsupported_currency",
      reason: `This merchant settles in INR; mandate is denominated in ${mandate.currency}.`,
    };
  }

  if (!Number.isInteger(mandate.max_amount_paise) || mandate.max_amount_paise <= 0) {
    return {
      valid: false,
      code: "invalid_amount",
      reason: "Mandate max_amount_paise must be a positive whole number of paise.",
    };
  }

  const now = Date.now();
  const expiresAt = Date.parse(mandate.expires_at);
  const issuedAt = Date.parse(mandate.issued_at);

  if (!Number.isFinite(expiresAt) || !Number.isFinite(issuedAt)) {
    return { valid: false, code: "malformed", reason: "Mandate timestamps are not valid dates." };
  }
  if (now > expiresAt) {
    return {
      valid: false,
      code: "expired",
      reason: `Mandate expired at ${mandate.expires_at}. A buyer agent must obtain fresh authority from its principal.`,
    };
  }
  // Small tolerance for clock skew between the buyer's issuer and this merchant.
  if (issuedAt - now > 60_000) {
    return {
      valid: false,
      code: "not_yet_valid",
      reason: `Mandate is issued in the future (${mandate.issued_at}).`,
    };
  }

  return { valid: true, mandate };
}

/**
 * Signs a receipt the buyer agent can verify and reconcile against its own
 * records. Without this, a buyer agent has only the merchant's word that an
 * order was accepted at a given amount — fine when a human is reading the
 * screen, not fine when the "customer" is a program that must reconcile
 * spend against the mandate it was granted.
 */
export function signReceipt(receipt: Record<string, unknown>): string {
  const payloadSegment = b64url(JSON.stringify(receipt));
  return `${payloadSegment}.${sign(payloadSegment)}`;
}

/** Counterpart to signReceipt(), for the buyer side of the demo. */
export function verifyReceipt(
  token: string
): { valid: true; receipt: Record<string, unknown> } | { valid: false; reason: string } {
  if (typeof token !== "string" || !token.includes(".")) {
    return { valid: false, reason: "Receipt is not a signed payload." };
  }
  const [payloadSegment, providedSignature] = token.split(".", 2);
  const a = Buffer.from(sign(payloadSegment));
  const b = Buffer.from(providedSignature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: "Receipt signature does not verify." };
  }
  try {
    return { valid: true, receipt: JSON.parse(fromB64url(payloadSegment).toString("utf8")) };
  } catch {
    return { valid: false, reason: "Receipt payload is not valid JSON." };
  }
}

/** Redacts the mandate down to what is safe and useful to store in audit_log. */
export function mandateForAudit(mandate: SpendMandate) {
  return {
    buyer_agent_id: mandate.buyer_agent_id,
    principal: mandate.principal,
    max_amount_paise: mandate.max_amount_paise,
    purpose: mandate.purpose,
    expires_at: mandate.expires_at,
    nonce: mandate.nonce,
  };
}
