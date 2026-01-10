// netlify/functions/stripe-webhook.js
console.log(
  "LOADED stripe-webhook v2026-01-10-SPONSOR-REMAINING-GEOM-FIX+EMAIL-GATE+UUID-SAFETY+CHECKOUT-META+ASSERTIONS+ACTIVE_ONLY"
);

// CommonJS (Netlify functions)
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

// ✅ IMPORTANT: treat ONLY 'active' as blocking.
// Anything else during checkout lifecycle must NOT claim the slot.
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

// ✅ NEW: fail-fast assertions (pinpoints the "f" culprit BEFORE Supabase/Postgres)
function assertUuidOrNull(name, v) {
  if (v == null) return;
  if (!isUuid(v)) {
    // This will show EXACTLY which field became "f"/false/"" etc
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

// ---- Stripe / Supabase error classifiers ----
function isOverlapDbError(err) {
  const code = err?.code || err?.cause?.code;
  const msg = String(err?.message || err?.cause?.message || "");

  // ✅ Do NOT treat all 23505 as overlap (that was over-canceling)
  return (
    code === "P0001" ||
    msg.toLowerCase().includes("area overlaps an existing sponsored area") ||
    msg.toLowerCase().includes("sponsorship exceeds available remaining area") ||
    msg.toLowerCase().includes("overlaps")
  );
}

function isDuplicateActiveSlotError(err) {
  const code = err?.code || err?.cause?.code;
  const msg = String(err?.message || err?.cause?.message || "");
  // Your logs show constraint name "ux_active_area_slot"
  return code === "23505" && (msg.includes("ux_active_area_slot") || msg.includes("uniq_active_slot_per_business"));
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
  const isBlocking = BLOCKING.has(status);
  const meta = subscription?.metadata || {};

  const business_id = uuidOrNull(metaGet(meta, "business_id", "cleaner_id", "cleanerId"));
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

  // Only set sponsored_geom for blocking statuses; otherwise null
  const sponsored_geom = isBlocking ? (geomFromMeta || null) : null;

  // ✅ If metadata is missing/invalid UUIDs, do NOT allow a "blocking" row
  const safeStatus =
    "incomplete";

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

  const geomFromMeta = metaGet(meta, "sponsored_geom", "sponsoredGeom", "geom", "geometry");
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
    status: "incomplete", // non-blocking
    current_period_end: null,
    sponsored_geom,
    updated_at: new Date().toISOString(),
  };
}

// ---- DB ops ----
async function upsertSubscriptionRow(sb, row) {
  const { data, error } = await sb
    .from("sponsored_subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" })
    .select("id, business_id, status, stripe_subscription_id")
    .maybeSingle();

  return { data, error };
}

async function upsertCheckoutDraft(sb, row) {
  if (!row?.stripe_subscription_id) return { data: null, error: null };

  const { data, error } = await sb
    .from("sponsored_subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" })
    .select("id, business_id, status, stripe_subscription_id")
    .maybeSingle();

  return { data, error };
}

async function hasAcceptedSponsoredRow(sb, subscriptionId) {
  if (!subscriptionId) return false;

  const { data, error } = await sb
    .from("sponsored_subscriptions")
    .select("id, business_id, status")
    .eq("stripe_subscription_id", subscriptionId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) return false;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.business_id) return false;

  return BLOCKING.has(String(row.status || "").toLowerCase());
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

    // 1) checkout.session.completed → upsert draft row (incomplete) keyed by subscription id
    if (type === "checkout.session.completed") {
      const session = obj;

      const draft = normalizeSponsoredRowFromCheckoutSession(session);

      if (!draft.stripe_subscription_id)
        return ok(200, { ok: true, skipped: "no-sub-id" });

      // ✅ ASSERT UUIDs HERE (this is where "f" will be caught)
      assertUuidOrNull("business_id", draft.business_id);
      assertUuidOrNull("area_id", draft.area_id);
      assertUuidOrNull("category_id", draft.category_id);

      const { data, error } = await upsertCheckoutDraft(sb, draft);
      if (error) {
        console.error("[webhook] upsert checkout draft error:", error, draft);
        return ok(200, { ok: false, error: "DB write failed (draft)" });
      }

      return ok(200, { ok: true, wroteDraft: true, id: data?.id || null });
    }

    // 2) subscription.* → upsert subscription row (still non-blocking unless status becomes active)
    if (type.startsWith("customer.subscription.")) {
      const sub = obj;

      const row = normalizeSponsoredRowFromSubscription(sub);

      if (!row.stripe_subscription_id)
        return ok(200, { ok: true, skipped: "no-sub-id" });

      // ✅ ASSERT UUIDs HERE TOO
      assertUuidOrNull("business_id", row.business_id);
      assertUuidOrNull("area_id", row.area_id);
      assertUuidOrNull("category_id", row.category_id);

      const { data, error } = await upsertSubscriptionRow(sb, row);

      if (error) {
        console.error("[webhook] upsert sponsored_subscriptions error:", error, row);

        // Cancel ONLY on true overlap/sold-out or true active-slot duplicates
        if (isOverlapDbError(error) || isDuplicateActiveSlotError(error)) {
          await safeCancelSubscription(sub.id, "Overlap/Sold-out/duplicate violation");
          return ok(200, { ok: true, canceled: true });
        }

        return ok(200, { ok: false, error: "DB write failed" });
      }

      return ok(200, { ok: true, wrote: true, id: data?.id || null });
    }

    // 3) invoice.paid → create invoice + email only if accepted row exists
    if (type === "invoice.paid") {
      const inv = obj;

      const subscriptionId =
        typeof inv.subscription === "string"
          ? inv.subscription
          : inv.subscription?.id || null;

      const accepted = await hasAcceptedSponsoredRow(sb, subscriptionId);

      if (!accepted) {
        console.warn(
          "[webhook] invoice.paid but no accepted sponsored_subscriptions row; skipping email",
          { invoice: inv.id, subId: subscriptionId }
        );
        return ok(200, { ok: true, skipped: "no-accepted-row" });
      }

      try {
        const result = await createInvoiceAndEmailByStripeInvoiceId(inv.id, {
          force: true,
        });
        console.log("[webhook] createInvoiceAndEmail result:", inv.id, result);
      } catch (e) {
        console.error(
          "[webhook] createInvoiceAndEmail ERROR:",
          inv.id,
          e?.message || e
        );
      }

      return ok(200, { ok: true });
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
