import { NextResponse } from "next/server";
import { publicJwks } from "@/lib/ap2";

/**
 * The merchant's public signing key, so any party can verify an AP2 mandate
 * this merchant issued without holding a shared secret.
 *
 * This is the half of asymmetric signing that actually buys interoperability:
 * a buyer agent that has never exchanged a secret with this merchant can
 * still check that a mandate is genuine. See lib/ap2.ts.
 */
export async function GET() {
  return NextResponse.json(publicJwks(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
