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
 * DEMO SIMPLIFICATION, stated plainly: in production each merchant would be a
 * separate host serving its own /.well-known/agent-commerce.json under its own
 * domain and its own Razorpay account. Here they are two storefronts inside
 * one deployment, distinguished by `?merchant=`, sharing one catalog table
 * partitioned by category and one test-mode Razorpay account. What that costs
 * in realism it buys back in something you can actually watch happen. The
 * parts that matter — separate manifests, separate caps, separate upsell
 * behaviour, and a buyer that treats them as independent counterparties over
 * plain HTTP — are genuinely separate.
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
};

export const MERCHANTS: Merchant[] = [
  {
    id: "chai-point-express",
    name: "Chai Point Express",
    tagline: "Chai, coffee, and hot snacks",
    category: "food_and_beverage.cafe",
    sells: ["beverage", "snack"],
    autonomousCapPaise: 50000, // ₹500
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
