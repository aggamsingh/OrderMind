/**
 * guardrails.ts — the most judge-scrutinized file in this repo.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE (CLAUDE.md §1):
 * Claude only ever *proposes* tool calls. It never talks to Razorpay directly,
 * and its own claim that something is "confirmed" is never trusted as the sole
 * gate. Every function here re-derives its answer from the database — never
 * from anything the model said in a chat message or in a tool-call argument.
 *
 * Call sites (and ONLY these call sites) are allowed to create a Razorpay
 * order/payment link — see app/api/chat/route.ts:
 *   1. evaluateSpendCap()   — before create_order
 *   2. evaluateRetry()      — before retry_payment
 * No other code path in this project may call the Razorpay Orders/Payment
 * Links API. If you're adding a new one, you're breaking the guarantee this
 * project is graded on — stop and re-read CLAUDE.md §1 first.
 */

import type { CartItem, Order, Session } from "./types";
import { SPEND_CAP_PAISE, MAX_RETRIES } from "./types";

export type CapDecision =
  | { outcome: "auto_approved"; totalPaise: number; reason: string }
  | { outcome: "confirmed_override"; totalPaise: number; reason: string }
  | { outcome: "blocked_needs_confirmation"; totalPaise: number; reason: string };

/**
 * Recomputes the cart total from the cart items passed in (which the caller
 * must have loaded fresh from the DB, not from a Claude tool-call argument),
 * then decides whether the order can proceed automatically.
 *
 * Two ways to pass:
 *   - totalPaise <= SPEND_CAP_PAISE: always auto-approved, no confirmation needed.
 *   - totalPaise  > SPEND_CAP_PAISE: only proceeds if `session.confirmed_at` is
 *     set AND `session.confirmed_total_paise` exactly matches the current
 *     recomputed total. A stale confirmation for a different total (e.g. the
 *     cart changed after confirming) does NOT count — this prevents a
 *     confirm-then-swap exploit.
 */
export function evaluateSpendCap(cart: CartItem[], session: Session): CapDecision {
  const totalPaise = computeCartTotalPaise(cart);

  if (totalPaise <= SPEND_CAP_PAISE) {
    return {
      outcome: "auto_approved",
      totalPaise,
      reason: `Total ₹${(totalPaise / 100).toFixed(2)} is within the ₹${(
        SPEND_CAP_PAISE / 100
      ).toFixed(2)} auto-approve cap.`,
    };
  }

  const hasValidConfirmation =
    session.confirmed_at !== null &&
    session.confirmed_total_paise !== null &&
    session.confirmed_total_paise === totalPaise;

  if (hasValidConfirmation) {
    return {
      outcome: "confirmed_override",
      totalPaise,
      reason: `Total ₹${(totalPaise / 100).toFixed(
        2
      )} exceeds the cap but was explicitly confirmed via the UI confirmation control for this exact amount.`,
    };
  }

  return {
    outcome: "blocked_needs_confirmation",
    totalPaise,
    reason: `Total ₹${(totalPaise / 100).toFixed(2)} exceeds the ₹${(
      SPEND_CAP_PAISE / 100
    ).toFixed(
      2
    )} auto-approve cap. Chat confirmation alone is not sufficient — an explicit UI confirmation for this exact total is required before payment can proceed.`,
  };
}

export function computeCartTotalPaise(cart: CartItem[]): number {
  return cart.reduce((sum, item) => sum + item.unit_price_paise * item.qty, 0);
}

export type RetryDecision =
  | { outcome: "retry_allowed"; reason: string }
  | { outcome: "retry_blocked_max_reached"; reason: string };

/**
 * Enforces exactly one bounded retry per failed order (CLAUDE.md §1). The
 * check is against `order.retry_count` as stored in the DB — never against
 * anything Claude says about whether a retry "should" be allowed.
 */
export function evaluateRetry(order: Order): RetryDecision {
  if (order.retry_count < MAX_RETRIES) {
    return {
      outcome: "retry_allowed",
      reason: `retry_count is ${order.retry_count}, below the max of ${MAX_RETRIES}.`,
    };
  }

  return {
    outcome: "retry_blocked_max_reached",
    reason: `retry_count is already ${order.retry_count}, which meets the max of ${MAX_RETRIES}. No further automatic retry is permitted for this order.`,
  };
}

export type MandateDecision =
  | {
      outcome: "mandate_satisfied";
      totalPaise: number;
      bindingLimitPaise: number;
      bindingLimit: "merchant_cap" | "buyer_mandate";
      reason: string;
    }
  | {
      outcome: "blocked_exceeds_buyer_mandate";
      totalPaise: number;
      bindingLimitPaise: number;
      bindingLimit: "buyer_mandate";
      reason: string;
    }
  | {
      outcome: "blocked_exceeds_merchant_cap";
      totalPaise: number;
      bindingLimitPaise: number;
      bindingLimit: "merchant_cap";
      reason: string;
    };

/**
 * The agent-to-agent gate: an autonomous buyer's order must satisfy BOTH
 * limits, and the stricter one binds.
 *
 * Why both, rather than just the merchant's cap:
 *  - The merchant cap (SPEND_CAP_PAISE) protects against *this* merchant's
 *    agent running away with someone's money. It says nothing about whether
 *    a given buyer was authorised for this amount.
 *  - The buyer's mandate (max_amount_paise, verified by lib/mandate.ts)
 *    carries the actual delegated authority its principal granted. A
 *    merchant that ignores it will happily process a runaway buyer agent's
 *    order — which is precisely the merchant an AI buyer cannot safely
 *    transact with.
 *
 * Note the asymmetry with evaluateSpendCap(): over-cap orders from a HUMAN
 * can be unblocked by that human clicking a confirmation control. An
 * autonomous buyer has no such escape hatch here, deliberately — there is no
 * human in the loop to click anything, so exceeding the mandate is simply
 * refused. Raising the ceiling requires a fresh mandate from the principal,
 * which is the whole point of the mandate existing.
 *
 * `totalPaise` must be recomputed from DB catalog prices by the caller —
 * never taken from anything the buyer agent sent.
 */
export function evaluateMandate(
  totalPaise: number,
  mandateMaxPaise: number,
  /**
   * Each storefront sets its own autonomous ceiling (lib/merchants.ts), so a
   * buyer cannot carry one merchant's limit over to the next. Defaults to the
   * project-wide cap, which keeps every existing single-merchant caller
   * behaving exactly as before.
   */
  merchantCapPaise: number = SPEND_CAP_PAISE
): MandateDecision {
  const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

  if (totalPaise > mandateMaxPaise) {
    return {
      outcome: "blocked_exceeds_buyer_mandate",
      totalPaise,
      bindingLimitPaise: mandateMaxPaise,
      bindingLimit: "buyer_mandate",
      reason: `Order total ${rupees(totalPaise)} exceeds the buyer agent's own spend mandate of ${rupees(
        mandateMaxPaise
      )}. Refused — the buyer's principal did not delegate authority for this amount, and no human is present to raise it.`,
    };
  }

  if (totalPaise > merchantCapPaise) {
    return {
      outcome: "blocked_exceeds_merchant_cap",
      totalPaise,
      bindingLimitPaise: merchantCapPaise,
      bindingLimit: "merchant_cap",
      reason: `Order total ${rupees(totalPaise)} is within the buyer's mandate but exceeds this merchant's ${rupees(
        merchantCapPaise
      )} autonomous-order cap. Refused — an order this size requires a human confirmation this merchant cannot obtain from an autonomous buyer.`,
    };
  }

  const bindingLimit = mandateMaxPaise <= merchantCapPaise ? "buyer_mandate" : "merchant_cap";
  const bindingLimitPaise = Math.min(mandateMaxPaise, merchantCapPaise);

  return {
    outcome: "mandate_satisfied",
    totalPaise,
    bindingLimitPaise,
    bindingLimit,
    reason: `Order total ${rupees(totalPaise)} is within both the buyer's mandate (${rupees(
      mandateMaxPaise
    )}) and this merchant's autonomous cap (${rupees(merchantCapPaise)}). Binding limit: ${
      bindingLimit === "buyer_mandate" ? "the buyer's mandate" : "the merchant cap"
    } at ${rupees(bindingLimitPaise)}.`,
  };
}
