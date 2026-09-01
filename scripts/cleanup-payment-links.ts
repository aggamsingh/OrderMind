/**
 * Cancels stale Razorpay payment links to stay under the test-mode ceiling.
 *
 * WHY THIS EXISTS — a demo-day landmine, found the hard way:
 * Razorpay test mode allows only **30 payment links**. Past that, every
 * attempt to create one fails with:
 *
 *   RATE_LIMIT_EXCEEDED — "test mode limit of 30 reached for payment_link"
 *
 * Every order this project places — human chat, autonomous agent, retries,
 * each leg of a split basket — creates one. A week of testing exhausts the
 * quota silently, and the failure surfaces as "Order accepted but the payment
 * link could not be created" at the exact moment a judge is watching.
 *
 * Worse, until lib/errors.ts was shared into the agent path, this failure was
 * logged as "[object Object]" and was effectively undiagnosable. It only
 * became findable once the real Razorpay error made it into the audit trail.
 *
 * Only cancellable links are touched: `paid` and already-`cancelled` ones are
 * left alone, since cancelling a paid link is meaningless and this script
 * should never be able to disturb a real transaction record.
 *
 * Run before a demo:  npx tsx scripts/cleanup-payment-links.ts
 * Preview only:       npx tsx scripts/cleanup-payment-links.ts --dry-run
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { getRazorpayClient } from "../lib/razorpay";

const DRY_RUN = process.argv.includes("--dry-run");

type Link = { id: string; status: string; amount: number; created_at: number; short_url: string };

async function main() {
  const razorpay = getRazorpayClient();

  const all: Link[] = [];
  // The API pages; a test account should never be huge, but don't assume.
  for (let skip = 0; skip < 200; skip += 100) {
    const page = (await razorpay.paymentLink.all({ count: 100, skip })) as unknown as {
      payment_links?: Link[];
    };
    const batch = page.payment_links ?? [];
    all.push(...batch);
    if (batch.length < 100) break;
  }

  const byStatus = all.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`${all.length} payment links on this test account`);
  for (const [status, n] of Object.entries(byStatus)) console.log(`  ${String(n).padStart(3)}  ${status}`);

  // Anything not paid and not already cancelled is holding a slot for nothing.
  const stale = all.filter((l) => l.status !== "paid" && l.status !== "cancelled");
  console.log(`\n${stale.length} cancellable (unpaid, still open)`);

  if (stale.length === 0) {
    console.log("Nothing to clean up.");
    return;
  }
  if (DRY_RUN) {
    console.log("--dry-run: nothing cancelled.");
    return;
  }

  let cancelled = 0;
  let failed = 0;
  for (const link of stale) {
    try {
      await razorpay.paymentLink.cancel(link.id);
      cancelled += 1;
    } catch {
      // A link can become uncancellable between listing and cancelling (paid
      // in the meantime, expired). Not worth failing the whole cleanup over.
      failed += 1;
    }
  }

  console.log(`\ncancelled ${cancelled}, could not cancel ${failed}`);
  console.log(`~${30 - (all.length - cancelled)} slots free of the 30 test-mode limit`);
}

main().catch((err) => {
  console.error("Cleanup failed:", err instanceof Error ? err.message : JSON.stringify(err));
  process.exit(1);
});
