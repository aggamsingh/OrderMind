import { NextResponse } from "next/server";
import { MERCHANTS } from "@/lib/merchants";

/**
 * Merchant directory — one entry point from which a buyer agent can discover
 * every merchant available to it, then read each one's manifest and compare.
 *
 * This is what turns "a merchant an agent can buy from" into "a market an
 * agent can shop in". A buyer that can only be pointed at a single storefront
 * isn't really shopping; it's executing a purchase someone else already
 * decided on.
 *
 * Each entry links to that merchant's own manifest rather than duplicating
 * its terms here, so there is exactly one authoritative statement of any
 * merchant's limits — a directory that restated caps would eventually
 * disagree with the merchants it lists.
 */
export async function GET() {
  return NextResponse.json({
    protocol_version: "0.1",
    count: MERCHANTS.length,
    merchants: MERCHANTS.map((m) => ({
      id: m.id,
      name: m.name,
      tagline: m.tagline,
      category: m.category,
      currency: "INR",
      manifest: `/.well-known/agent-commerce.json?merchant=${m.id}`,
      catalog: `/api/agent/catalog?merchant=${m.id}`,
    })),
    note: "Each merchant states its own terms in its own manifest. Read them per merchant — limits differ, and one merchant's cap does not generalise to another.",
  });
}
