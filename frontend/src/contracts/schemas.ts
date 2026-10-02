import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });
const money = z.object({ amount: z.number().int(), currency: z.string().min(3).max(3), scale: z.number().int().min(0).max(6) });
const duration = z.object({ unit: z.enum(["day", "month", "year"]), count: z.number().int().positive() }).nullable();

export const sessionSchema = z.object({
  user: z.object({
    id: z.string().min(1), email: z.string().email(), display_name: z.string(),
    roles: z.array(z.enum(["reader", "publisher", "support", "manager", "admin"])),
    publisher_id: z.string().nullable(),
    preferences: z.object({ time_zone: z.string(), language: z.enum(["fr", "mg", "en"]) }),
    is_demo: z.boolean(),
  }),
  expires_at: isoDateTime,
});

export const offerSchema = z.object({
  id: z.string(), version: z.number().int().positive(), kind: z.enum(["free", "single", "subscription"]),
  title: z.string(), description: z.string(), price: money, duration,
  renewal: z.enum(["manual", "none"]),
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("edition"), edition_id: z.string(), publication_id: z.string(), label: z.string() }),
    z.object({ kind: z.literal("collection"), universe: z.enum(["presse", "business", "culture"]), label: z.string(), includes_future_additions: z.boolean() }),
    z.object({ kind: z.literal("free_selection"), label: z.string() }),
  ]),
  restrictions: z.array(z.string()), conditions_version: z.string().min(1),
  status: z.enum(["active", "unavailable", "sold_out", "retired"]), status_reason: z.string().nullable(),
  quota: z.object({ total: z.number().int().nonnegative(), remaining: z.number().int().nonnegative() }).nullable(), is_demo: z.boolean(),
});

const eligibility = z.object({
  offer_id: z.string(), can_purchase: z.boolean(), already_owned: z.boolean(),
  blocking_reason: z.enum(["ALREADY_OWNED", "OFFER_UNAVAILABLE", "OFFER_SOLD_OUT", "AUTH_REQUIRED", "FREE_CONTENT", "PENDING_ORDER"]).nullable(),
  overlaps: z.array(z.object({ entitlement_id: z.string(), description: z.string() })), pending_order_id: z.string().nullable(),
});

export const quoteSchema = z.object({
  quote_id: z.string(), offer: offerSchema, lines: z.array(z.object({ label: z.string(), amount: money })), total: money,
  access_starts_at: isoDateTime, access_ends_at: isoDateTime.nullable(), eligibility,
  renewal_of_subscription_id: z.string().nullable(), quote_expires_at: isoDateTime,
});

const offerSnapshot = z.object({
  offer_id: z.string(), offer_version: z.number().int(), title: z.string(), kind: z.enum(["free", "single", "subscription"]),
  price: money, duration, renewal: z.enum(["manual", "none"]), scope_label: z.string(), conditions_version: z.string(),
});

export const orderSchema = z.object({
  id: z.string(), reference: z.string(), status: z.enum(["created", "pending_payment", "paid", "fulfilled", "cancelled", "payment_exception"]),
  lines: z.array(z.object({ label: z.string(), snapshot: offerSnapshot, amount: money })), total: money,
  created_at: isoDateTime, updated_at: isoDateTime,
  payment: z.object({ status: z.enum(["initiated", "pending", "succeeded", "failed", "cancelled", "refund_pending", "refunded"]), provider: z.string(), mode: z.enum(["test", "sandbox", "live"]), updated_at: isoDateTime }).nullable(),
  reservation: z.object({ status: z.enum(["reserved", "consumed", "released", "expired"]), expires_at: isoDateTime }).nullable(),
  subscription_id: z.string().nullable(), edition_id: z.string().nullable(), renewal_of_subscription_id: z.string().nullable(),
  receipt_available: z.boolean(), exception_reason: z.string().nullable(), is_demo: z.boolean(),
});

export const proposalSchema = z.object({
  id: z.string(), type: z.enum(["purchase", "cancel_subscription", "change_plan", "create_support_case", "access_exception"]),
  status: z.enum(["pending", "confirmed", "rejected", "expired", "superseded", "failed"]), title: z.string(),
  resource: z.object({ type: z.string(), id: z.string(), label: z.string(), version: z.number().int() }),
  consequences: z.array(z.string()), amount: money.nullable(), conditions_version: z.string().nullable(), expires_at: isoDateTime,
  approval: z.enum(["self", "manager"]), origin: z.enum(["form", "assistant"]), created_at: isoDateTime,
  result: z.object({ summary: z.string(), links: z.array(z.object({ label: z.string(), to: z.string() })) }).nullable(),
});

export const assetAccessSchema = z.object({
  asset_id: z.string(), edition_id: z.string(), title: z.string(), edition_label: z.string(), publication_slug: z.string(),
  format: z.enum(["text", "pdf"]), url: z.string().min(1), media_type: z.enum(["text/markdown", "application/pdf"]),
  expires_at: isoDateTime, download_allowed: z.boolean(),
});

const publicStep = z.object({ key: z.string(), label: z.string(), state: z.enum(["running", "done", "failed"]) });
const runStatus = z.enum(["queued", "running", "waiting_user", "waiting_approval", "completed", "failed", "cancelled"]);
export const runEventSchema = z.discriminatedUnion("type", [
  z.object({ seq: z.number().int().nonnegative(), run_id: z.string(), at: isoDateTime, type: z.literal("status"), status: runStatus }),
  z.object({ seq: z.number().int().nonnegative(), run_id: z.string(), at: isoDateTime, type: z.literal("step"), step: publicStep }),
  z.object({ seq: z.number().int().nonnegative(), run_id: z.string(), at: isoDateTime, type: z.literal("message"), message_id: z.string() }),
  z.object({ seq: z.number().int().nonnegative(), run_id: z.string(), at: isoDateTime, type: z.literal("error"), code: z.string(), message: z.string() }),
]);

export const runEventsSchema = z.array(runEventSchema);
