// netlify/functions/stripe-webhook.js
console.log("LOADED stripe-webhook v2026-01-23-HARDEN-STATUS+CANCEL-DB");

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
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
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
  );
}
function uuidOrNull(v) {
  const s = (v ?? "").toString().trim();
  return isUuid(s) ? s : null;
}
function assertUuidOrNull(name, v) {
  if (v == null) return;
  if (!isUuid(v)) throw new Error(`BAD UUID ${name}=${JSON.stringify(v)}`);
}

// ---- metadata helpers ----
function metaGet(meta, ...keys) {
  if (!meta) return null;
  for (const k of keys) {
    if (meta[k] != null && String(meta[k]).trim() !== "") return String(meta[k]).trim();
  }
  return null;
}
function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---- Stripe/Supabase error classifiers ----
function isOverlapDbError(err) {
  const code = err?.code || err?.cause?.code;
  const msg = String(err?.message || err?.cause?.message || "").toLowerCase();
  return (
    code === "P0001" ||
    msg.includes("area overlaps an existing sponsored area") ||
    msg.includes("sponsorship exceeds available remaining area") ||
    msg.includes("overlaps") ||
    msg.includes("remaining area") ||
    msg.includes("sold out") ||
    msg.includes("available remaining area")
  );
}

// ---- Stripe cancel (safe/idempotent) ----
async function safeCancelSubscription(subId, why) {
  if (!subId) return { ok: false, reason: "no-sub-id" };
  try {
    console.warn("[webhook] canceling subscription:", subId, why);

    // retrieve first to avoid "cancelled subscription can only update metadata" errors
    let sub = null;
    try {
      sub = await stripe.subscriptions.retrieve(subId);
    } catch (_) {}

    if (sub && sub.status === "canceled") {
      return { ok: true, alreadyCanceled: true };
    }

    if (stripe.subscriptions?.cancel) await stripe.subscriptions.cancel(subId);
    else if (stripe.subscriptions?.del) await stripe.subscriptions.del(subId);
    else await stripe.subscriptions.update(subId, { cancel_at_period_end: true });

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

// ---- DB helpers ----
async function upsertByStripeSubscriptionId(sb, row) {
  return sb
    .from("sponsored_subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" })
    .select("id, business_id, status, stripe_subscription_id, current_period_end")
    .maybeSingle();
}

async function fetchExistingBySubId(sb, stripe_subscription_id) {
  if (!stripe_subscription_id) return { data: null, error: null };
  return sb
    .from("sponsored_subscriptions")
    .select("id, status, current_period_end")
    .eq("stripe_subscription_id", stripe_subscription_id)
    .maybeSingle();
}

function normalizeStatus(s) {
  return String(s || "").trim().toLowerCase();
}

/**
 * IMPORTANT RULE:
 * - Only invoice.paid activation RPC is allowed to make DB status "active".
 * - Subscription events should never force "active" into DB, because activation may fail (overlap).
 */
function preserveActive(existing, incoming) {
  if (normalizeStatus(existing?.status) === "active") {
    incoming.status = "active";
    if (!incoming.current_period_end) incoming.current_period_end = existing.current_period_end || null;
  }
  return incoming;
}

async function markDbCanceled(sb, stripeSubId, reason) {
  if (!stripeSubId) return;

  // best effort: mark any row for this subscription as canceled
  const { error } = await sb
    .from("sponsored_subscriptions")
    .update({
      status: "canceled",
      cancel_at_period_end: true,
      updated_at: new Date().toISOString(),
      // if you have a column for it, keep this; otherwise harmless if column doesn't exist? (it WILL error)
      // activation_error: reason,
    })
    .eq("stripe_subscription_id", stripeSubId);

  if (error) {
    // If you don't have cancel_at_period_end/status columns exactly, you'll see it here.
    // Still don't fail the webhook.
    console.warn("[webhook] markDbCanceled update failed (non-fatal):", error?.message || error);
  }
}

// ---- Normalize helpers ----
// NOTE: subscription events should NOT try to use invoice-derived periods.
// invoice.paid will pass the real current_period_end to the activation RPC.
function normalizeSponsoredRowFromSubscription(subscription) {
  const stripeStatus = normalizeStatus(subscription?.status);
  const meta = subscription?.metadata || {};

  const business_id = uuidOrNull(metaGet(meta, "business_id", "cleaner_id", "cleanerId"));
  const area_id = uuidOrNull(metaGet(meta, "area_id", "areaId"));
  const category_id = uuidOrNull(metaGet(meta, "category_id", "categoryId"));

  const slotRaw = metaGet(meta, "slot");
  const slotNum = numOrNull(slotRaw);
  const slot = slotNum && slotNum > 0 ? Math.floor(slotNum) : 1;

  const item = subscription?.items?.data?.[0] || null;
  const unitAmount = item?.price?.unit_amount ?? item?.plan?.amount ?? null;

  const metaAmount = metaGet(meta, "price_monthly_pennies", "price_monthly_pence", "amount_pennies");

  const priceParsed =
    (typeof unitAmount === "number" && Number.isFinite(unitAmount) ? unitAmount : null) ??
    (metaAmount && Number.isFinite(Number(metaAmount)) ? Number(metaAmount) : null) ??
    100;

  const price_monthly_pennies = Math.max(0, Math.round(Number(priceParsed)));
  const currency = (item?.price?.currency || subscription?.currency || "gbp").toLowerCase();

  const periodEndFromSub = subscription?.current_period_end ?? null;
  const current_period_end =
    typeof periodEndFromSub === "number" && Number.isFinite(periodEndFromSub)
      ? new Date(periodEndFromSub * 1000).toISOString()
      : null;

// NEVER set DB 'active' from subscription events
let safeStatus = "incomplete";
if (["trialing", "past_due", "unpaid"].includes(stripeStatus)) safeStatus = stripeStatus;
if (["canceled", "incomplete_expired"].includes(stripeStatus)) safeStatus = "canceled";



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
    updated_at: new Date().toISOString(),
  };
}

function normalizeSponsoredRowFromCheckoutSession(session) {
  const meta = session?.metadata || {};

  const business_id = uuidOrNull(metaGet(meta, "business_id", "cleaner_id", "cleanerId"));
  const area_id = uuidOrNull(metaGet(meta, "area_id", "areaId"));
  const category_id = uuidOrNull(metaGet(meta, "category_id", "categoryId"));

  const slotRaw = metaGet(meta, "slot");
  const slotNum = numOrNull(slotRaw);
  const slot = slotNum && slotNum > 0 ? Math.floor(slotNum) : 1;

  const amountTotal = numOrNull(session?.amount_total);
  const price_monthly_pennies = amountTotal != null ? Math.max(0, Math.round(amountTotal)) : 100;

  const currency = String(session?.currency || "gbp").toLowerCase();

  const stripe_subscription_id =
    typeof session?.subscription === "string" ? session.subscription : null;

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
    updated_at: new Date().toISOString(),
  };
}

// ---- handler ----
exports.handler = async (event) => {
  try {
    const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
    const webhookSecret = requireEnv("STRIPE_WEBHOOK_SECRET");
    if (!sig) {
      console.error("[webhook] missing stripe-signature header");
      return ok(400, { ok: false, error: "missing stripe-signature" });
    }

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : (event.body || "");

    const stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    const sb = getSupabaseAdmin();

    const type = stripeEvent.type;
    const obj = stripeEvent.data.object;

    if (
      type === "checkout.session.completed" ||
      type.startsWith("customer.subscription.") ||
      type === "invoice.paid" ||
      type === "invoice.finalized"
    ) {
      console.log("[webhook]", type, "id=" + stripeEvent.id);
    }

    // 0) invoice.finalized -> optional invoice email creation (non-blocking)
    if (type === "invoice.finalized") {
      const inv = obj;
      try {
        await createInvoiceAndEmailByStripeInvoiceId(inv.id);
        console.log("[webhook] invoice.finalized -> created invoice/email", inv.id);
      } catch (e) {
        console.error("[webhook] invoice.finalized -> createInvoiceAndEmail failed", inv.id, e?.message || e);
      }
      return ok(200, { ok: true, handled: "invoice.finalized" });
    }

    // 1) checkout.session.completed → store metadata early (incomplete)
    if (type === "checkout.session.completed") {
      const session = obj;
      const draft = normalizeSponsoredRowFromCheckoutSession(session);

      if (!draft.stripe_subscription_id) return ok(200, { ok: true, skipped: "no-sub-id" });

      assertUuidOrNull("business_id", draft.business_id);
      assertUuidOrNull("area_id", draft.area_id);
      assertUuidOrNull("category_id", draft.category_id);

      const { data: existing } = await fetchExistingBySubId(sb, draft.stripe_subscription_id);
      preserveActive(existing, draft);

      const { data, error } = await upsertByStripeSubscriptionId(sb, draft);
      if (error) {
        console.error("[webhook] upsert checkout draft error:", error, draft);
        return ok(200, { ok: false, error: "DB write failed (draft)" });
      }

      return ok(200, { ok: true, wroteDraft: true, id: data?.id || null, status: data?.status || null });
    }

    // 2) customer.subscription.* → upsert row (NEVER force active here)
    if (type.startsWith("customer.subscription.")) {
      const sub = obj;

      // If Stripe says deleted, mark DB canceled and return
      if (type === "customer.subscription.deleted") {
        const sid = sub?.id || null;
        if (sid) await markDbCanceled(sb, sid, "stripe_deleted");
        return ok(200, { ok: true, handled: "subscription.deleted" });
      }

      const row = normalizeSponsoredRowFromSubscription(sub);
      if (!row.stripe_subscription_id) return ok(200, { ok: true, skipped: "no-sub-id" });

      assertUuidOrNull("business_id", row.business_id);
      assertUuidOrNull("area_id", row.area_id);
      assertUuidOrNull("category_id", row.category_id);

      const { data: existing } = await fetchExistingBySubId(sb, row.stripe_subscription_id);
      preserveActive(existing, row);

      const { data, error } = await upsertByStripeSubscriptionId(sb, row);
      if (error) {
        console.error("[webhook] upsert sponsored_subscriptions error:", error, row);

        if (isOverlapDbError(error)) {
          await safeCancelSubscription(sub.id, "Overlap/Sold-out violation (subscription event)");
          await markDbCanceled(sb, sub.id, "overlap_subscription_event");
          return ok(200, { ok: true, canceled: true });
        }

        return ok(200, { ok: false, error: "DB write failed" });
      }

      return ok(200, { ok: true, wrote: true, id: data?.id || null, status: data?.status || null });
    }

    // 3) invoice.paid → ACTIVATE USING LOCK GEOMETRY
    if (type === "invoice.paid") {
      const inv = obj;

      let fullInv = inv;
      try {
        fullInv = await stripe.invoices.retrieve(inv.id, {
          expand: ["subscription", "lines.data.subscription"],
        });
      } catch (e) {
        console.error("[webhook] invoice.retrieve failed:", inv.id, e?.message || e);
        return ok(200, { ok: false, error: "invoice.retrieve failed" });
      }

      const subscriptionId =
        typeof fullInv?.subscription === "string"
          ? fullInv.subscription
          : fullInv?.subscription?.id ||
            fullInv?.lines?.data?.find((l) => typeof l?.subscription === "string")?.subscription ||
            null;

      if (!subscriptionId) {
        console.warn("[webhook] invoice.paid still missing subscription id", { invoice: fullInv.id });
        return ok(200, { ok: true, skipped: "no-sub-id" });
      }

      const periodEndSec = fullInv?.lines?.data?.[0]?.period?.end ?? null;
      const current_period_end =
        typeof periodEndSec === "number" && Number.isFinite(periodEndSec)
          ? new Date(periodEndSec * 1000).toISOString()
          : null;

      // retrieve subscription metadata to get lock_id
      let sub;
      try {
        sub = await stripe.subscriptions.retrieve(subscriptionId);
      } catch (e) {
        console.error("[webhook] subscriptions.retrieve failed:", subscriptionId, e?.message || e);
        return ok(200, { ok: false, error: "subscriptions.retrieve failed" });
      }

      const lockId = uuidOrNull(sub?.metadata?.lock_id || sub?.metadata?.lockId || null);
      if (!lockId) {
        console.error("[webhook] invoice.paid missing lock_id on subscription metadata", {
          subscriptionId,
          metadata: sub?.metadata || {},
        });
        await safeCancelSubscription(subscriptionId, "Missing lock_id metadata");
        await markDbCanceled(sb, subscriptionId, "missing_lock_id");
        return ok(200, { ok: false, error: "missing lock_id" });
      }

      const { error: actErr } = await sb.rpc("activate_sponsored_subscription_from_lock", {
        p_stripe_subscription_id: subscriptionId,
        p_lock_id: lockId,
        p_current_period_end: current_period_end,
      });

if (actErr) {
  console.error("[webhook] invoice.paid activate error:", actErr, { subscriptionId, lockId });

  if (isOverlapDbError(actErr)) {
    await safeCancelSubscription(subscriptionId, "Activation overlap/sold-out");

    await sb
      .from("sponsored_subscriptions")
      .update({
        status: "canceled",
        cancel_at_period_end: true,
        updated_at: new Date().toISOString(),
        geom: null,
        sponsored_geom: null,
        sponsored_geojson: null,
        final_geojson: null,
        area_km2: null,
      })
      .eq("stripe_subscription_id", subscriptionId);

    return ok(200, { ok: true, canceled: true, reason: "overlap_sold_out" });
  }

  // ✅ non-overlap activation error
  return ok(200, { ok: false, error: "activate failed" });
}


      // optional debug
      try {
        const { data: chk, error: chkErr } = await sb
          .from("sponsored_subscriptions")
          .select("id,status,current_period_end")
          .eq("stripe_subscription_id", subscriptionId)
          .maybeSingle();

        if (chkErr) console.error("[webhook] post-activate row check ERROR", chkErr);
        else console.log("[webhook] post-activate row check", chk);
      } catch (e) {
        console.error("[webhook] post-activate check threw", e?.message || e);
      }

      console.log("[webhook] activated subscription", subscriptionId, "lockId", lockId);
      return ok(200, { ok: true, activated: true, subscriptionId });
    }

    // default: ignore other event types
    return ok(200, { ok: true, ignored: type });
  } catch (err) {
    console.error("[webhook] fatal error:", err);
    const msg = String(err?.message || err || "");
    const isSig =
      msg.toLowerCase().includes("no signatures found") ||
      msg.toLowerCase().includes("signature");
    return ok(isSig ? 400 : 500, { ok: false, error: msg });
  }
};
