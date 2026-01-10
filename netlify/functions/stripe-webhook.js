// netlify/functions/stripe-webhook.js
console.log(
  "LOADED stripe-webhook v2026-01-10-SPONSOR-REMAINING-GEOM-FIX+EMAIL-GATE+UUID-SAFETY+CHECKOUT-META+ASSERTIONS+ACTIVE_ONLY+ACTIVATE_ON_INVOICE_PAID"
);

// CommonJS (Netlify functions)
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
// kept import (email/invoicing), but invoice.paid activation does NOT depend on it
const { createInvoiceAndEmailByStripeInvoiceId } = require("./_lib/createInvoiceCore");

// ---- env helpers ----
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function getSupabaseAdmin() {
  const url = requireEnv("SUPABASE_URL");
  const key =
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;

  if (!key) throw new Error("Missing Supabase service role key env var");

  return createClient(url, key, { auth: { persistSession: false } });
}

const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-06-20",
});

// ✅ IMPORTANT: only ACTIVE is blocking / owns inventory
const BLOCKING = new Set(["active"]);

// ---- HTTP helper ----
function ok(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ---- uuid helpers ----
function isUuid(s) {
  return (
    typeof s === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      s
    )
  );
}
function uuidOrNull(v) {
  const s = (v ?? "").toString().trim();
  return isUuid(s) ? s : null;
}

// ✅ Fail-fast assertions (pinpoints bad UUIDs before hitting DB)
function assertUuidOrNull(name, v) {
  if (v == null) return;
  if (!isUuid(v)) {
    throw new Error(`BAD UUID ${name}=${JSON.stringify(v)}`);
  }
}

// ---- metadata helpers ----
function metaGet(meta, ...keys) {
  if (!meta) return null;
  for (const k of keys) {
    if (meta[k] != null && String(meta[k]).trim() !== "")
      return String(meta[k]).trim();
  }
  return null;
}

function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---- invoice helpers ----
// ✅ Robustly extract subscription id from an invoice payload
function getInvoiceSubId(inv) {
  if (typeof inv?.subscription === "string") return inv.subscription;
  if (typeof inv?.subscription?.id === "string") return inv.subscription.id;

  const lineSub =
    inv?.lines?.data?.find((l) => typeof l?.subscription === "string")
      ?.subscription;
  if (lineSub) return lineSub;

  return null;
}

// ---- Stripe / Supabase error classifiers ----
function isOverlapDbError(err) {
  const code = err?.code || err?.cause?.code;
  const msg = String(err?.message || err?.cause?.message || "").toLowerCase();

  // ✅ Do NOT treat all 23505 as overlap
  return (
    code === "P0001" ||
    msg.includes("area overlaps an existing sponsored area") ||
    msg.includes("sponsorship exceeds available remaining area") ||
    msg.includes("overlaps")
  );
}

async function safeCancelSubscription(subId, why) {
  if (!subId) return { ok: false, reason: "no-sub-id" };

  try {
    console.warn("[webhook] canceling subscription:", subId, why);

    // Compatibility across Stripe SDK versions:
    if (stripe.subscriptions?.cancel) {
      await stripe.subscriptions.cancel(subId);
    } else if (stripe.subscriptions?.del) {
      await stripe.subscriptions.del(subId);
    } else {
      await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
    }

    return { ok: true };
  } catch (e) {
    const msg = String(e?.message || "");
    if (msg.includes("No such subscription") || msg.includes("resource_missing")) {
      console.warn("[webhook] subscription already gone:", subId);
      return { ok: true, alreadyGone: true };
    }
    console.error("[webhook] failed to cancel subscription:", subId, msg);
    return { ok: false, error: msg };
  }
}

// ---- Normalize helpers ----
function normalizeSponsoredRowFromSubscription(subscription) {
  const status = String(subscription?.status || "").toLowerCase();
  const meta = subscription?.metadata || {};

  const business_id = uuidOrNull(
    metaGet(meta, "business_id", "cleaner_id", "cleanerId")
  );
  const area_id = uuidOrNull(metaGet(meta, "area_id", "areaId"));
  const category_id = uuidOrNull(metaGet(meta, "category_id", "categoryId"));

  // slot
  const slotRaw = metaGet(meta, "slot");
  const slotNum = numOrNull(slotRaw);
  const slot = slotNum && slotNum > 0 ? Math.floor(slotNum) : 1;

  // price
  const item = subscription?.items?.data?.[0] || null;
  const unitAmount = item?.price?.unit_amount ?? item?.plan?.amount ?? null;

  const metaAmount = metaGet(
    meta,
    "price_monthly_pennies",
    "price_monthly_pence",
    "amount_pennies"
  );

  const priceParsed =
    (typeof unitAmount === "number" && Number.isFinite(unitAmount)
      ? unitAmount
      : null) ??
    (metaAmount && Number.isFinite(Number(metaAmount)) ? Number(metaAmount) : null) ??
    100;

  const price_monthly_pennies = Math.max(0, Math.round(Number(priceParsed)));

  const currency = (item?.price?.currency || subscription?.currency || "gbp").toLowerCase();

  const current_period_end = subscription?.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  // sponsored geom from metadata (EWKT string)
  const geomFromMeta = metaGet(
    meta,
    "sponsored_geom",
    "sponsoredGeom",
    "geom",
    "geometry",
    "sponsored_geometry"
  );

  // ✅ We only allow sponsored_geom to be set when ACTIVE (blocking)
  const sponsored_geom = status === "active" ? (geomFromMeta || null) : null;

  // ✅ VERY IMPORTANT:
  // Do NOT mark rows active here. We activate on invoice.paid only.
  const safeStatus = "incomplete";

  return {
    business_id,
    area_id,
    category_id,
    slot,
    stripe_customer_id: subscription?.customer || null,
    stripe_subscription_id: subscription?.id || null,
    price_monthly_pennies,
    currency,
    status: safeStatus,
    current_period_end,
    sponsored_geom,
    updated_at: new Date().toISOString(),
  };
}

function normalizeSponsoredRowFromCheckoutSession(session) {
  const meta = session?.metadata || {};

  const business_id = uuidOrNull(
    metaGet(meta, "business_id", "cleaner_id", "cleanerId")
  );
  const area_id = uuidOrNull(metaGet(meta, "area_id", "areaId"));
  const category_id = uuidOrNull(metaGet(meta, "category_id", "categoryId"));

  const slotRaw = metaGet(meta, "slot");
  const slotNum = numOrNull(slotRaw);
  const slot = slotNum && slotNum > 0 ? Math.floor(slotNum) : 1;

  // amount_total usually in cents; your DB expects pennies/cents integer anyway
  const amountTotal = numOrNull(session?.amount_total);
  const price_monthly_pennies =
    amountTotal != null ? Math.max(0, Math.round(amountTotal)) : 100;

  const currency = String(session?.currency || "gbp").toLowerCase();

  const stripe_subscription_id =
    typeof session?.subscription === "string" ? session.subscription : null;

  const geomFromMeta = metaGet(
    meta,
    "sponsored_geom",
    "sponsoredGeom",
    "geom",
    "geometry"
  );
  const sponsored_geom = geomFromMeta || null;

  return {
    business_id,
    area_id,
    category_id,
    slot,
    stripe_customer_id: session?.customer || null,
    stripe_subscription_id,
    price_monthly_pennies,
    currency,
    status: "incomplete",
    current_period_end: null,
    sponsored_geom,
    updated_at: new Date().toISOString(),
  };
}

// ---- DB ops ----
async function upsertByStripeSubscriptionId(sb, row) {
  const { data, error } = await sb
    .from("sponsored_subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" })
    .select("id, business_id, status, stripe_subscription_id")
    .maybeSingle();

  return { data, error };
}

// ---- handler ----
exports.handler = async (event) => {
  try {
    const sig =
      event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
    const webhookSecret = requireEnv("STRIPE_WEBHOOK_SECRET");

    const stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      webhookSecret
    );

    const sb = getSupabaseAdmin();

    const type = stripeEvent.type;
    const obj = stripeEvent.data.object;

    if (
      type === "checkout.session.completed" ||
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted" ||
      type === "invoice.paid" ||
      type === "invoice.finalized"
    ) {
      console.log("[webhook]", type, "id=" + stripeEvent.id);
    }

    // 1) checkout.session.completed → store metadata early (incomplete) keyed by subscription id
    if (type === "checkout.session.completed") {
      const session = obj;
      const draft = normalizeSponsoredRowFromCheckoutSession(session);

      if (!draft.stripe_subscription_id)
        return ok(200, { ok: true, skipped: "no-sub-id" });

      // UUID assertions (helps catch "f")
      assertUuidOrNull("business_id", draft.business_id);
      assertUuidOrNull("area_id", draft.area_id);
      assertUuidOrNull("category_id", draft.category_id);

      const { data, error } = await upsertByStripeSubscriptionId(sb, draft);
      if (error) {
        console.error("[webhook] upsert checkout draft error:", error, draft);
        return ok(200, { ok: false, error: "DB write failed (draft)" });
      }

      return ok(200, { ok: true, wroteDraft: true, id: data?.id || null });
    }

    // 2) customer.subscription.* → upsert row, but ALWAYS keep it non-blocking here
    if (type.startsWith("customer.subscription.")) {
      const sub = obj;

      const row = normalizeSponsoredRowFromSubscription(sub);
      if (!row.stripe_subscription_id)
        return ok(200, { ok: true, skipped: "no-sub-id" });

      assertUuidOrNull("business_id", row.business_id);
      assertUuidOrNull("area_id", row.area_id);
      assertUuidOrNull("category_id", row.category_id);

      const { data, error } = await upsertByStripeSubscriptionId(sb, row);

      if (error) {
        console.error("[webhook] upsert sponsored_subscriptions error:", error, row);

        // Only cancel on REAL overlap/sold-out errors (not random uniques)
        if (isOverlapDbError(error)) {
          await safeCancelSubscription(sub.id, "Overlap/Sold-out violation");
          return ok(200, { ok: true, canceled: true });
        }

        return ok(200, { ok: false, error: "DB write failed" });
      }

      return ok(200, { ok: true, wrote: true, id: data?.id || null });
    }

    // 3) invoice.paid → THIS is where we activate (claim inventory)
    if (type === "invoice.paid") {
      const inv = obj;
      const subscriptionId = getInvoiceSubId(inv);

      if (!subscriptionId) {
        console.warn("[webhook] invoice.paid missing subscription id", { invoice: inv.id });
        return ok(200, { ok: true, skipped: "no-sub-id" });
      }

      // Try to pull a sensible period end from the first line item if present
      const periodEndSec = inv?.lines?.data?.[0]?.period?.end ?? null;
      const current_period_end =
        typeof periodEndSec === "number" && Number.isFinite(periodEndSec)
          ? new Date(periodEndSec * 1000).toISOString()
          : null;

      // ✅ Activate (this will trigger your DB allocation/overlap/unique active slot rules)
      const { data, error } = await sb
        .from("sponsored_subscriptions")
        .update({
          status: "active",
          current_period_end,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_subscription_id", subscriptionId)
        .select("id, status, business_id, area_id, slot")
        .maybeSingle();

      if (error) {
        console.error("[webhook] invoice.paid activate error:", error, { subscriptionId });

        // If activation failed due to overlap/sold-out, cancel subscription to unwind
        if (isOverlapDbError(error)) {
          await safeCancelSubscription(subscriptionId, "Activation overlap/sold-out");
          return ok(200, { ok: true, canceled: true });
        }

        return ok(200, { ok: false, error: "activate failed" });
      }

      console.log("[webhook] activated subscription", subscriptionId, data);
      return ok(200, { ok: true, activated: true, subscriptionId });
    }

    // ignore everything else
    return ok(200, { ok: true });
  } catch (err) {
    console.error("[webhook] handler error:", err);
    const msg = String(err?.message || "");
    const isSig = msg.includes("No signatures found") || msg.includes("signature");
    return ok(isSig ? 400 : 200, { ok: false, error: msg });
  }
};
