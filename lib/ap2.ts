/**
 * ap2.ts — AP2-aligned mandates, so a third-party agent can transact here.
 *
 * WHY: this project's native mandate (lib/mandate.ts) is HMAC-signed with a
 * shared secret. That is fine when the buyer's issuer and the merchant agree
 * a secret out of band, and useless the moment a buyer this merchant has
 * never met wants to pay. Interoperability needs a format others already
 * speak and a signature anyone can verify without holding a secret.
 *
 * Google's Agent Payments Protocol (AP2) is the closest thing to that: a
 * Payment Mandate carrying vct, transaction_id, payee, payment_amount,
 * payment_instrument, iat/exp, and (for the open variant) constraints. The
 * field names and the ES256 signing algorithm here are taken from the
 * published spec, not invented — see ap2-protocol.org/ap2/payment_mandate.
 *
 * WHAT IS AND IS NOT IMPLEMENTED, precisely, because a vague interop claim
 * is worse than no claim at all:
 *
 *   IMPLEMENTED  AP2 Payment Mandate field vocabulary and vct values.
 *   IMPLEMENTED  ES256 (ECDSA P-256 + SHA-256) asymmetric signing, so any
 *                party can verify against the public key published at
 *                /.well-known/jwks.json without sharing a secret.
 *   IMPLEMENTED  constraints on the open variant, carrying the spend ceiling
 *                this merchant actually enforces.
 *   NOT YET      SD-JWT selective disclosure. AP2 wraps these claims in an
 *                SD-JWT with hashed disclosures so a payer can reveal some
 *                fields and withhold others. This emits a plain compact JWS
 *                with the same claims, so a strict AP2 verifier expecting
 *                tilde-separated disclosures will not accept it.
 *
 * The honest claim is therefore "AP2-aligned, ES256-signed, selective
 * disclosure not yet implemented" — not "AP2 compliant".
 *
 * This layer is ADDITIVE. The native HMAC path is untouched and remains the
 * default; an AP2 mandate is simply a second accepted proof of authority.
 */

import crypto from "crypto";
import type { SpendMandate } from "./mandate";

const AP2_VCT_OPEN = "mandate.payment.open.1";

/**
 * Cached so sign and verify use the SAME key. Without this the dev fallback
 * minted a fresh keypair on every call, and every token this merchant signed
 * failed its own verification — silently, and only for the fallback path.
 */
let cachedKeys: { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject } | null = null;

/** Loads the merchant's ES256 keypair, generating an ephemeral one if unset. */
function getKeyPair(): { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject } {
  if (cachedKeys) return cachedKeys;

  const pem = process.env.AP2_PRIVATE_KEY_PEM;
  if (pem) {
    const privateKey = crypto.createPrivateKey(pem.replace(/\\n/g, "\n"));
    cachedKeys = { privateKey, publicKey: crypto.createPublicKey(privateKey) };
    return cachedKeys;
  }
  // Dev fallback: a per-process key. Verifiable within one running instance,
  // useless across restarts — which is exactly why production should set the
  // env var. Throwing here would break local dev for an optional feature;
  // failing silently would be worse, so the JWKS response flags itself as
  // ephemeral instead.
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  cachedKeys = { privateKey, publicKey };
  return cachedKeys;
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4), "base64");

export type AP2PaymentMandate = {
  vct: string;
  transaction_id: string;
  payee: { id: string; name: string; website?: string };
  payment_amount: { amount: number; currency: string };
  payment_instrument: { id: string; type: string; description?: string };
  iat: number;
  exp: number;
  /** Open-variant limits. This merchant enforces max_amount server-side. */
  constraints?: { max_amount: { amount: number; currency: string }; purpose?: string }[];
  /** Who delegated, and to whom. AP2 leaves subject identification to the issuer. */
  sub: string;
  agent_id: string;
};

/** Maps this project's native mandate onto AP2's Payment Mandate vocabulary. */
export function toAP2PaymentMandate(
  mandate: SpendMandate,
  merchant: { id: string; name: string }
): AP2PaymentMandate {
  return {
    vct: AP2_VCT_OPEN,
    transaction_id: mandate.nonce,
    payee: { id: merchant.id, name: merchant.name },
    payment_amount: { amount: mandate.max_amount_paise, currency: mandate.currency },
    payment_instrument: { id: "razorpay-checkout", type: "psp_hosted_checkout" },
    iat: Math.floor(Date.parse(mandate.issued_at) / 1000),
    exp: Math.floor(Date.parse(mandate.expires_at) / 1000),
    constraints: [
      {
        max_amount: { amount: mandate.max_amount_paise, currency: mandate.currency },
        purpose: mandate.purpose,
      },
    ],
    sub: mandate.principal,
    agent_id: mandate.buyer_agent_id,
  };
}

/** Signs AP2 claims as a compact JWS with ES256. */
export function signAP2(claims: AP2PaymentMandate): string {
  const { privateKey } = getKeyPair();
  const header = b64url(JSON.stringify({ alg: "ES256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  // ieee-p1363 IS the raw r-then-s encoding JWS requires, so Node produces a
  // JOSE-shaped signature directly. Asking for DER here and converting by
  // hand is a well-known source of signatures that verify nowhere.
  const signature = crypto.sign("sha256", Buffer.from(header + "." + payload), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return header + "." + payload + "." + b64url(signature);
}

export type AP2Verification =
  | { valid: true; claims: AP2PaymentMandate }
  | { valid: false; reason: string };

/**
 * Verifies an AP2 mandate. Signature first, for the same reason every other
 * check in this project does it first: until it passes, the amounts and the
 * subject are attacker-controlled text.
 *
 * `publicKeyPem` lets a caller verify against a buyer's OWN key rather than
 * this merchant's — which is the point of asymmetric signing, and how a
 * third-party agent's mandate would be checked once its issuer publishes a
 * JWKS. Defaults to this merchant's key for round-tripping its own tokens.
 */
export function verifyAP2(token: string, publicKeyPem?: string): AP2Verification {
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "Not a compact JWS." };
  const [header, payload, signature] = parts;

  let alg: string;
  try {
    alg = JSON.parse(fromB64url(header).toString("utf8")).alg;
  } catch {
    return { valid: false, reason: "Unreadable JWS header." };
  }
  // Reject anything that is not ES256 explicitly, rather than letting the
  // token's own header choose the algorithm — that is the classic JWT
  // algorithm-confusion attack.
  if (alg !== "ES256") {
    return { valid: false, reason: "Unsupported alg " + alg + "; this merchant requires ES256." };
  }

  const key = publicKeyPem ? crypto.createPublicKey(publicKeyPem) : getKeyPair().publicKey;

  let ok = false;
  try {
    ok = crypto.verify(
      "sha256",
      Buffer.from(header + "." + payload),
      { key, dsaEncoding: "ieee-p1363" },
      fromB64url(signature)
    );
  } catch {
    return { valid: false, reason: "Malformed signature." };
  }
  if (!ok) return { valid: false, reason: "ES256 signature does not verify." };

  let claims: AP2PaymentMandate;
  try {
    claims = JSON.parse(fromB64url(payload).toString("utf8"));
  } catch {
    return { valid: false, reason: "Unreadable claims." };
  }

  if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) {
    return { valid: false, reason: "AP2 mandate has expired." };
  }
  if (!claims.payment_amount || typeof claims.payment_amount.amount !== "number") {
    return { valid: false, reason: "AP2 mandate is missing payment_amount." };
  }
  if (claims.payment_amount.currency !== "INR") {
    return {
      valid: false,
      reason: "This merchant settles in INR, not " + claims.payment_amount.currency + ".",
    };
  }

  return { valid: true, claims };
}

/** Public key as a JWKS, so anyone can verify without a shared secret. */
export function publicJwks() {
  const { publicKey } = getKeyPair();
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, string>;
  return {
    keys: [{ ...jwk, use: "sig", alg: "ES256", kid: "ordermind-ap2-1" }],
    ephemeral: !process.env.AP2_PRIVATE_KEY_PEM,
  };
}

/** Converts verified AP2 claims into the native mandate the guardrails expect. */
export function ap2ToSpendMandate(claims: AP2PaymentMandate): SpendMandate {
  return {
    buyer_agent_id: claims.agent_id ?? "ap2-buyer-agent",
    principal: claims.sub ?? "ap2-principal",
    max_amount_paise: claims.payment_amount.amount,
    currency: "INR",
    purpose: claims.constraints?.[0]?.purpose ?? "AP2 mandate",
    issued_at: new Date((claims.iat ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    expires_at: new Date(claims.exp * 1000).toISOString(),
    nonce: claims.transaction_id,
  };
}
