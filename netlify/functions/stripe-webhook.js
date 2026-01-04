// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

console.log("LOADED stripe-webhook v2026-01-04-REMAINING-GEOM-RPC");

// -----------------------------
// Setup
// -----------------------------
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Stripe webhook signature (recommended)
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// statuses that are considered "blocking" (treated as owned/taken)
const BLOCKING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

// -----------------------------
// Helpers
// -----------------------------
function lower(x) {
  return String(x || "").toLowerCase();
}

function safeEventName(evt) {
  return evt?.type || "unknown.event";
}

function extractMeta(obj) {
  // obj can be checkout session or subscription
  const meta = obj?.metadata || {};
  return {
    business_id:
      meta.business_id ||
      meta.cleaner_id ||
      meta.cleanerId ||
      meta.businessId ||
      null,
    area_id: meta.area_id || meta.areaId || null,
    category_id: meta.category_id || meta.categoryId || null,
    slot: Number(meta.slot || 1),
    lock_id: meta.lock_id || null,
  };
}

async function releaseLockSafe(lockId) {
  if (!lockId) return;
  try {
    await sb.from("sponsored_locks").update({ is_active: false }).eq("id", lockId);
  } catch (e) {
    console.error("[webhook] failed to release lock:", lockId, e?.message || e);
  }
}

/**
 * Gets subscription object from stripe by id and returns:
 *  - status
 *  - current_period_end ISO (if available)
 */
async function getStripeSubscription(subId) {
  if (!subId) return { status: null, currentPeriodEndIso: null };
  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    const currentPeriodEndIso = sub?.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null;
    return { status: sub?.status || null, currentPeriodEndIso };
  } catch (e) {
    console.warn("[webhook] could not retrieve subscription:", subId, e?.message || e);
    return { status: null, currentPeriodEndIso: null };
  }
}

/**
 * Upserts sponsored subscription using DB-side RPC that computes remaining geom
 * and forces multipolygon.
 *
 * IMPORTANT:
 * You must have created this RPC in Supabase:
 *
 * public.upsert_sponsored_subscription_remaining(
 *   p_business_id uuid,
 *   p_area_id uuid,
 *   p_category_id uuid,
 *   p_slot integer,
 *   p_stripe_customer_id text,
 *   p_stripe_subscription_id text,
 *   p_price_monthly_pennies integer,
 *   p_currency text,
 *   p_status text,
 *   p_current_period_end timestamptz
 * )
 */
async function upsertSponsoredViaRemainingRPC(payload) {
  const {
    business_id,
    area_id,
    category_id,
    slot,
    stripe_customer_id,
    stripe_subscription_id,
    price_monthly_pennies,
    currency,
    status,
    current_period_end,
  } = payload;

  const { data, error } = await sb.rpc("upsert_sponsored_subscription_remaining", {
    p_business_id: business_id,
    p_area_id: area_id,
    p_category_id: category_id,
    p_slot: slot,
    p_stripe_customer_id: stripe_customer_id,
    p_stripe_subscription_id: stripe_subscription_id,
    p_price_monthly_pennies: price_monthly_pennies,
    p_currency: currency,
    p_status: status,
    p_current_period_end: current_period_end,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return row || { ok: true, reason: "ok" };
}

/**
 * When Stripe creates/updates subs, we want to mirror into DB.
 * We only treat certain statuses as blocking in UI.
 */
async function mirrorSubscriptionToDB({ business_id, area_id, category_id, slot, custId, subId, pricePennies, currency, status, currentPeriodEndIso, lock_id }) {
  if (!business_id || !area_id || !category_id || !custId || !subId) {
    console.warn("[webhook] missing required identifiers; skip DB write", {
      business_id,
      area_id,
      category_id,
      slot,
      custId,
      subId,
    });
    await releaseLockSafe(lock_id);
    return { ok: false, reason: "missing_meta" };
  }

  // If it's not blocking, we still upsert (so you can show billing state),
  // but your trigger currently only blocks overlap for BLOCKING statuses.
  const safeStatus = lower(status || "active");

  try {
    const row = await upsertSponsoredViaRemainingRPC({
      business_id,
      area_id,
      category_id,
      slot,
      stripe_customer_id: custId,
      stripe_subscription_id: subId,
      price_monthly_pennies: typeof pricePennies === "number" ? pricePennies : null,
      currency: lower(currency || "gbp"),
      status: safeStatus,
      current_period_end: currentPeriodEndIso,
    });

    // Always release lock if present (purchase attempt is finished)
    await releaseLockSafe(lock_id);

    // If no remaining geom, treat as graceful "nothing to own" (shouldn’t happen
    // if your UI correctly blocks checkout when remaining is 0, but can happen
    // due to race conditions).
    if (row?.reason === "no_remaining") {
      console.warn("[webhook] no remaining after compute; lock released.", {
        business_id,
        area_id,
        category_id,
        slot,
        stripe_subscription_id: subId,
      });
      return { ok: true, reason: "no_remaining" };
    }

    return { ok: true, reason: "ok" };
  } catch (e) {
    // If overlap trigger fires, we want to gracefully release lock, and NOT crash the whole function repeatedly.
    const msg = e?.message || "";
    const code = e?.code || "";

    // P0001 for raise exception, 23505 etc also possible
    const isOverlap =
      msg.includes("Area overlaps an existing sponsored area") ||
      msg.includes("overlaps an existing sponsored area");

    if (isOverlap) {
      console.warn("[webhook] overlap prevented DB write; lock will be released.", {
        business_id,
        area_id,
        category_id,
        slot,
        stripe_subscription_id: subId,
      });
      await releaseLockSafe(lock_id);
      return { ok: false, reason: "overlap" };
    }

    console.error("[stripe-webhook] DB upsert failed:", e);
    await releaseLockSafe(lock_id);
    throw e;
  }
}

/**
 * Get price from checkout session line item if present.
 */
function getUnitAmountFromSession(session) {
  const unit =
    session?.line_items?.data?.[0]?.price?.unit_amount ??
    session?.amount_total ??
    null;
  return typeof unit === "number" ? unit : null;
}

/**
 * Fetch and expand checkout session (subscription/customer/line items)
 */
async function fetchCheckoutSession(sessionId) {
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription", "customer", "line_items.data.price"],
  });
}

/**
 * Returns customer id string from session/subscription object
 */
function extractCustomerId(x) {
  if (!x) return null;
  return typeof x === "string" ? x : x?.id || null;
}

function extractSubscriptionId(x) {
  if (!x) return null;
  return typeof x === "string" ? x : x?.id || null;
}

// -----------------------------
// Webhook handler
// -----------------------------
export default async (req) => {
  if (req.method === "GET") {
    return json({ ok: true, note: "stripe-webhook is deployed. Send Stripe events via webhook POST." });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  // Stripe signature verification (if WEBHOOK_SECRET provided)
  let event;
  try {
    const raw = await req.text();

    if (WEBHOOK_SECRET) {
      const sig = req.headers.get("stripe-signature");
      event = stripe.webhooks.constructEvent(raw, sig, WEBHOOK_SECRET);
    } else {
      // Fallback (not recommended)
      event = JSON.parse(raw);
    }
  } catch (e) {
    console.error("[stripe-webhook] signature/parse error:", e?.message || e);
    return json({ ok: false, error: "Invalid webhook" }, 400);
  }

  const type = safeEventName(event);
  const obj = event?.data?.object;

  // log type only (avoid dumping entire payload)
  console.log(`[webhook] ${type} id=${event?.id || "no-id"}`);

  try {
    // -----------------------------
    // checkout.session.completed
    // -----------------------------
    if (type === "checkout.session.completed") {
      // obj is a checkout session summary; fetch full expanded session so we always have subscription/customer/line items
      const sessionId = obj?.id;
      const session = await fetchCheckoutSession(sessionId);

      // session.status in Stripe is "complete" on success
      if (session?.status !== "complete") {
        return json({ ok: true, ignored: true, reason: `session.status=${session?.status}` });
      }

      const custId = extractCustomerId(session.customer);
      const subId = extractSubscriptionId(session.subscription);

      const meta = extractMeta(session);
      const business_id = meta.business_id;
      const area_id = meta.area_id;
      const category_id = meta.category_id;
      const slot = Number.isFinite(meta.slot) ? meta.slot : 1;
      const lock_id = meta.lock_id;

      const unitAmount = getUnitAmountFromSession(session);
      const currency = session?.currency || "gbp";

      // current period end best from subscription if expanded
      const subObj = typeof session.subscription === "string" ? null : session.subscription;
      const currentPeriodEndIso = subObj?.current_period_end
        ? new Date(subObj.current_period_end * 1000).toISOString()
        : null;

      // status from subscription if expanded; otherwise assume active
      const status = subObj?.status || "active";

      await mirrorSubscriptionToDB({
        business_id,
        area_id,
        category_id,
        slot,
        custId,
        subId,
        pricePennies: unitAmount,
        currency,
        status,
        currentPeriodEndIso,
        lock_id,
      });

      return json({ ok: true });
    }

    // -----------------------------
    // customer.subscription.created / updated / deleted
    // -----------------------------
    if (
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted"
    ) {
      const sub = obj; // subscription object
      const subId = sub?.id || null;
      const custId = extractCustomerId(sub?.customer);
      const status = lower(sub?.status || (type === "customer.subscription.deleted" ? "canceled" : "active"));
      const currency = (sub?.currency || "gbp").toLowerCase();

      const meta = extractMeta(sub);
      const business_id = meta.business_id;
      const area_id = meta.area_id;
      const category_id = meta.category_id;
      const slot = Number.isFinite(meta.slot) ? meta.slot : 1;
      const lock_id = meta.lock_id;

      // Try to get unit amount from the subscription items (if present)
      let unitAmount = null;
      try {
        unitAmount =
          sub?.items?.data?.[0]?.price?.unit_amount ??
          sub?.items?.data?.[0]?.plan?.amount ??
          null;
      } catch {
        unitAmount = null;
      }

      const currentPeriodEndIso = sub?.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;

      await mirrorSubscriptionToDB({
        business_id,
        area_id,
        category_id,
        slot,
        custId,
        subId,
        pricePennies: typeof unitAmount === "number" ? unitAmount : null,
        currency,
        status,
        currentPeriodEndIso,
        lock_id,
      });

      return json({ ok: true });
    }

    // -----------------------------
    // invoice.paid / invoice.payment_failed
    // (optional - do NOT change DB ownership rules here)
    // -----------------------------
    if (type === "invoice.paid") {
      // You can trigger invoice email/PDF here if you already have that.
      // Ownership rules are handled by subscription events + checkout completion.
      return json({ ok: true, ignored: true });
    }

    if (type === "invoice.payment_failed") {
      // You may notify business here. Do not mark geometry as free unless you
      // intentionally treat payment failure as non-blocking immediately.
      return json({ ok: true, ignored: true });
    }

    // default: acknowledge
    return json({ ok: true, ignored: true });
  } catch (e) {
    console.error("[stripe-webhook] handler error:", e);
    return json({ ok: false, error: e?.message || "Webhook handler failed" }, 500);
  }
};
