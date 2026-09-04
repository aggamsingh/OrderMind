/**
 * merchants.ts — the merchant registry.
 *
 * A protocol demonstrated against exactly one merchant proves very little.
 * The interesting question is whether a buyer agent can discover several,
 * compare them on equal terms, and choose — which is what actually happens
 * once agent-to-agent commerce is real, and what a single hardcoded
 * storefront can never show. Two merchants is the smallest number that makes
 * "shopping" mean anything.
 *
 * WHAT IS AND IS NOT SEPARATE, stated plainly:
 *
 *   Separate       manifests, autonomous caps, catalog ranges, upsell
 *                  behaviour, and a buyer that treats them as independent
 *                  counterparties reachable only over plain HTTP.
 *   Configurable   Razorpay account (razorpayKeyIdEnv/razorpayKeySecretEnv)
 *                  and public origin (hostEnv). Set them and a merchant
 *                  settles into its own account on its own host; leave them
 *                  and it falls back to the deployment's, which the manifest
 *                  reports as settlement_account: "shared_with_deployment"
 *                  rather than quietly implying otherwise.
 *   Shared         one deployment and one catalog table partitioned by
 *                  category, because two Next.js apps would cost a day and
 *                  demonstrate nothing this does not.
 */

export type Merchant = {
  id: string;
  name: string;
  tagline: string;
  category: string;
  /** Catalog categories this merchant sells. The catalog table is shared. */
  sells: string[];
  /**
   * Each merchant sets its own autonomous ceiling. Differing values are the
   * point: a buyer agent has to read each manifest rather than assume the
   * limits it learned from one merchant apply to the next.
   */
  autonomousCapPaise: number;
  /**
   * Env var names holding THIS merchant's Razorpay credentials. When unset,
   * the merchant falls back to the shared default keys.
   *
   * Genuinely separate merchants settle into genuinely separate accounts —
   * money landing in one balance rather than two is the difference between
   * two storefronts and two businesses. Wired as config so adding a real
   * second account is an env change, not a code change.
   */
  razorpayKeyIdEnv?: string;
  razorpayKeySecretEnv?: string;
  /**
   * Public origin this merchant is served from, when it has its own. Used to
   * emit absolute URLs in its manifest so a buyer agent can follow them from
   * anywhere. Unset means the same origin as the request.
   */
  hostEnv?: string;
};

export const MERCHANTS: Merchant[] = [
  {
    id: "chai-point-express",
    name: "Chai Point Express",
    tagline: "Chai, coffee, and hot snacks",
    category: "food_and_beverage.cafe",
    sells: ["beverage", "snack"],
    autonomousCapPaise: 50000, // ₹500
    razorpayKeyIdEnv: "RAZORPAY_KEY_ID",
    razorpayKeySecretEnv: "RAZORPAY_KEY_SECRET",
    hostEnv: "MERCHANT_CHAI_HOST",
  },
  {
    id: "sweet-street-desserts",
    name: "Sweet Street Desserts",
    tagline: "Mithai and desserts, made fresh",
    category: "food_and_beverage.dessert",
    sells: ["dessert", "snack"],
    // Deliberately tighter than Chai Point's. A buyer agent that assumed one
    // merchant's cap generalises will be refused here, which is the lesson.
    autonomousCapPaise: 30000, // ₹300
    // Falls back to the shared keys until a second Razorpay account exists.
    razorpayKeyIdEnv: "RAZORPAY_SWEET_KEY_ID",
    razorpayKeySecretEnv: "RAZORPAY_SWEET_KEY_SECRET",
    hostEnv: "MERCHANT_SWEET_HOST",
  },
];

export const DEFAULT_MERCHANT_ID = "chai-point-express";

export function getMerchant(id?: string | null): Merchant {
  if (!id) return MERCHANTS[0];
  return MERCHANTS.find((m) => m.id === id) ?? MERCHANTS[0];
}

export function isKnownMerchant(id?: string | null): boolean {
  return !!id && MERCHANTS.some((m) => m.id === id);
}

/**
 * Resolves a merchant's Razorpay credentials, falling back to the shared
 * default when it has none of its own.
 *
 * `isOwnAccount` is returned rather than hidden: a merchant quietly settling
 * into another merchant's account is exactly the kind of thing that belongs
 * in a manifest, not something to be discovered when the money turns up in
 * the wrong balance.
 */
export function merchantRazorpayCredentials(merchant: Merchant): {
  keyId?: string;
  keySecret?: string;
  isOwnAccount: boolean;
} {
  const keyId = merchant.razorpayKeyIdEnv ? process.env[merchant.razorpayKeyIdEnv] : undefined;
  const keySecret = merchant.razorpayKeySecretEnv
    ? process.env[merchant.razorpayKeySecretEnv]
    : undefined;

  // Only counts as its own account if BOTH halves are present. A half-set
  // pair would otherwise mix one merchant's key id with another's secret.
  if (keyId && keySecret) return { keyId, keySecret, isOwnAccount: true };

  return {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    isOwnAccount: false,
  };
}

/** This merchant's own public origin, when it has been given one. */
export function merchantHost(merchant: Merchant): string | null {
  return (merchant.hostEnv ? process.env[merchant.hostEnv] : undefined) ?? null;
}
