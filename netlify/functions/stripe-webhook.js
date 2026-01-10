// netlify/functions/stripe-webhook.js
console.log("LOADED stripe-webhook v2026-01-10-SPONSOR-REMAINING-GEOM-FIX+EMAIL-GATE+UUID-SAFETY+CHECKOUT-META");

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

const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), { apiVersion: "2024-06-20" });

// Only these statuses should be treated as “real/owned slot”
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

// ---- HTTP helper ----
function ok(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ---- uuid helpers (prevents 22P02: invalid input syntax for type uuid: "f") ----
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

// ---- Stripe / Supabase error classifiers ----
function isOverlapDbError(err) {
  const code = err?.code || err?.cause?.code;
  const msg = String(err?.message || err?.cause?.message || "");

  return (
    code === "P0001" ||
    code === "23505" || // sometimes overlap guards use unique-ish exceptions
    msg.includes("Area overlaps an existing sponsored area") ||
    msg.includes("sponsorship exceeds available remaining area") ||
    msg.includes("overlaps")
  );
}

function isDuplicateActiveSlotError(err) {
  const code = err?.code || err?.cause?.code;
  const msg = String(err?.message || err?.cause?.message || "");
  return code === "23505" && msg.includes("uniq_active_slot_per_business");
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

  // ✅ HARD UUID sanitation (prevents 22P02)
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

  const metaAmount = metaGet(meta, "price_monthly_pennies", "price_monthly_pence", "amount_pennies");
  const priceParsed =
    (typeof unitAmount === "number" && Number.isFinite(unitAmount) ? unitAmount : null) ??
    (metaAmount && Number.isFinite(Number(metaAmount)) ? Number(metaAmount) : null) ??
    100; // last-resort floor (never null)

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
  // (DB trigger will fill it if you prefer that, but keeping this optional)
  const sponsored_geom = isBlocking ? (geomFromMeta || null) : null;

  // ✅ If metadata is missing/invalid UUIDs, do NOT allow a "blocking" row
  // because it will hit triggers / unique partial index incorrectly.
  const safeStatus =
    isBlocking && (!business_id || !area_id || !category_id) ? "incomplete" : status;

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

  // May be present on session.amount_total (cents) depending on mode.
  // Your DB expects pennies.
  const amountTotal = numOrNull(session?.amount_total);
  const price_monthly_pennies =
    amountTotal != null ? Math.max(0, Math.round(amountTotal)) : 100;

  const currency = String(session?.currency || "gbp").toLowerCase();

  // Subscription id can be present on session.subscription
  const stripe_subscription_id =
    typeof session?.subscription === "string" ? session.subscription : null;

  const geomFromMeta = metaGet(meta, "sponsored_geom", "sponsoredGeom", "geom", "geometry");
  const sponsored_geom = geomFromMeta || null;

  // At checkout time, we don't know status; set incomplete
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
async function upsertSubscriptionRow(sb, row) {
  const { data, error } = await sb
    .from("sponsored_subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" })
    .select("id, business_id, status, stripe_subscription_id")
    .maybeSingle();

  return { data, error };
}

async function upsertCheckoutDraft(sb, row) {
  // Only upsert if we have a subscription id (otherwise nothing to key on)
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
    const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
    const webhookSecret = requireEnv("STRIPE_WEBHOOK_SECRET");

    const stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);

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

    // 1) checkout.session.completed → upsert a draft row (incomplete) keyed by subscription id
    // This helps you store metadata early, so later subscription.updated has everything.
    if (type === "checkout.session.completed") {
      const session = obj;

      const draft = normalizeSponsoredRowFromCheckoutSession(session);

      // If we can’t key it, skip.
      if (!draft.stripe_subscription_id) return ok(200, { ok: true, skipped: "no-sub-id" });

      const { data, error } = await upsertCheckoutDraft(sb, draft);
      if (error) {
        console.error("[webhook] upsert checkout draft error:", error, draft);
        // no cancel here; checkout completion alone shouldn't cancel
        return ok(200, { ok: false, error: "DB write failed (draft)" });
      }

      return ok(200, { ok: true, wroteDraft: true, id: data?.id || null });
    }

    // 2) subscription.* → upsert real subscription row
    if (type.startsWith("customer.subscription.")) {
      const sub = obj;

      const row = normalizeSponsoredRowFromSubscription(sub);

      if (!row.stripe_subscription_id) return ok(200, { ok: true, skipped: "no-sub-id" });

      const { data, error } = await upsertSubscriptionRow(sb, row);

      if (error) {
        console.error("[webhook] upsert sponsored_subscriptions error:", error, row);

        // If overlap/sold-out or duplicate active slot, cancel subscription
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
        console.warn("[webhook] invoice.paid but no accepted sponsored_subscriptions row; skipping email", {
          invoice: inv.id,
          subId: subscriptionId,
        });
        return ok(200, { ok: true, skipped: "no-accepted-row" });
      }

      try {
        const result = await createInvoiceAndEmailByStripeInvoiceId(inv.id, { force: true });
        console.log("[webhook] createInvoiceAndEmail result:", inv.id, result);
      } catch (e) {
        console.error("[webhook] createInvoiceAndEmail ERROR:", inv.id, e?.message || e);
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
