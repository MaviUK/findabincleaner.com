// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/stripe-webhook" };

if (!process.env.STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY");
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE");
}
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  // We don't throw here to avoid cold-start crashes during local tests,
  // but signature verification will still fail below if it's missing.
  console.warn("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set.");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

// ---- helpers ----
function normMeta(meta = {}) {
  // Accept snake_case and camelCase
  const cleaner_id = meta.cleaner_id || meta.business_id || meta.cleanerId || null;
  const area_id = meta.area_id || meta.areaId || null;
  const slot = Number(meta.slot || 1);
  const months = Number(meta.months || 1);
  const monthly_price_pennies =
    meta.monthly_price_pennies != null
      ? Number(meta.monthly_price_pennies)
      : meta.monthly_price != null
      ? Math.round(Number(meta.monthly_price) * 100)
      : null;

  return { cleaner_id, area_id, slot, months, monthly_price_pennies };
}

async function upsertSubscriptionFromStripe(sub, meta) {
  const { cleaner_id: business_id, area_id, slot } = normMeta(meta);
  if (!business_id || !area_id) return;

  await supabase
    .from("sponsored_subscriptions")
    .upsert(
      {
        business_id,
        area_id,
        slot,
        stripe_customer_id: sub.customer,
        stripe_subscription_id: sub.id,
        price_monthly_pennies: sub.items?.data?.[0]?.price?.unit_amount ?? null,
        currency: sub.currency || "gbp",
        status: sub.status, // 'active','past_due','canceled', etc
        current_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
      },
      { onConflict: "stripe_subscription_id" }
    );
}

async function upsertFromPaymentSession(session) {
  // For one-off 'payment' mode sessions (no subscription), we still want the slot to show as taken.
  // We write a row using a synthetic "subscription id" based on the session id.
  // This lets your v_area_slot_status view pick it up as 'active'.
  const meta = normMeta(session.metadata || {});
  const { cleaner_id: business_id, area_id, slot, months, monthly_price_pennies } = meta;

  if (!business_id || !area_id) return;

  // Derive a monthly price if we can:
  // Prefer metadata.monthly_price_pennies, else try amount_total / months (if provided).
  let priceMonthly = monthly_price_pennies;
  if (priceMonthly == null && typeof session.amount_total === "number" && months > 0) {
    priceMonthly = Math.round(session.amount_total / months);
  }

  const syntheticId = `checkout_${session.id}`;

  await supabase
    .from("sponsored_subscriptions")
    .upsert(
      {
        business_id,
        area_id,
        slot,
        stripe_customer_id: session.customer ?? null,
        stripe_subscription_id: syntheticId, // synthetic so it's unique for upsert
        price_monthly_pennies: priceMonthly ?? null,
        currency: session.currency || "gbp",
        status: "active", // treat a completed payment as active
        current_period_end: null, // not applicable for one-off
      },
      { onConflict: "stripe_subscription_id" }
    );
}

async function upsertLatestInvoice(inv) {
  // Link by subscription; if it's a synthetic "checkout_*" there won't be invoices — harmless no-op.
  const { data: subRow } = await supabase
    .from("sponsored_subscriptions")
    .select("id")
    .eq("stripe_subscription_id", inv.subscription
