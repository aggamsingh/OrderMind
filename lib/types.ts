// Shared types, mirroring supabase/schema.sql exactly. Keep in sync manually —
// this project has no codegen step, so a schema change must be reflected here by hand.

export type CatalogItem = {
  id: string;
  name: string;
  description: string;
  price_paise: number;
  category: string;
  pairs_well_with: string | null;
  is_available: boolean;
};

export type CartItem = {
  catalog_id: string;
  name: string;
  qty: number;
  unit_price_paise: number;
  reason: string;
  is_upsell?: boolean;
};

export type SessionStatus =
  | "browsing"
  | "awaiting_confirmation"
  | "confirmed"
  | "paid"
  | "failed";

export type Session = {
  id: string;
  created_at: string;
  cart: CartItem[];
  // Provider-agnostic conversation format (lib/llm/types.ts ConvMessage) —
  // never a specific provider's wire format, so switching LLM_PROVIDER
  // doesn't require migrating stored session data. See DECISIONS.md D-3.
  messages: import("./llm/types").ConvMessage[];
  status: SessionStatus;
  confirmed_at: string | null;
  confirmed_total_paise: number | null;
};

export type OrderStatus =
  | "created"
  | "payment_pending"
  | "paid"
  | "failed"
  | "retried"
  | "retry_failed";

export type Order = {
  id: string;
  session_id: string;
  razorpay_order_id: string | null;
  razorpay_payment_link_id: string | null;
  total_paise: number;
  status: OrderStatus;
  retry_count: number;
  created_at: string;
  updated_at: string;
};

// "buyer_agent" is an autonomous machine buyer transacting via /api/agent/*
// — deliberately distinct from "customer" (a human) so the audit trail shows
// *who* acted, not just what happened. See DECISIONS.md D-8.
export type AuditActor =
  | "customer"
  | "agent"
  | "orchestrator"
  | "razorpay_webhook"
  | "buyer_agent";

export type AuditLogRow = {
  id: string;
  session_id: string;
  order_id: string | null;
  actor: AuditActor;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
};

export const SPEND_CAP_PAISE = 50000; // ₹500 — see CLAUDE.md §1 and DECISIONS.md D-0
export const MAX_RETRIES = 1; // exactly one bounded retry — CLAUDE.md §1
