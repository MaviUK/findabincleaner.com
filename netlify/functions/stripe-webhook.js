// netlify/functions/stripe-webhook.js
console.log("LOADED stripe-webhook v2026-01-06-SPONSOR-REMAINING-GEOM-FIX+EMAIL-GATE");

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

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-06-20",
});

// Only these statuses should be treated as “real/owned slot”
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

// ---- helpers ----
function ok(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function isOverlapDbError(err) {
  const code = err?.code || err?.cause?.code;
  const msg = String(err?.message || err?.cause?.message || "");
  return (
    code === "P0001" ||
    code === "23505" ||
    msg.includes("Area overlaps an existing sponsored area") ||
    msg.includes("overlaps") ||
    msg.includes("sponsorship exceeds available remaining area")
  );
}

async function safeCancelSubscription(subId, why) {
  if (!subId) return { ok: false, reason: "no-sub-id" };

  try {
    console.warn("[webhook] canceling subscription:", subId, why);
    // Stripe node supports .cancel in newer versions, but .del is widely compatible
    await stripe.subscriptions.del(subId);
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

function metaGet(meta, ...keys) {
  if (!meta) return null;
  for (const k of keys) {
    if (meta[k] != null && String(meta[k]).trim() !== "") return String(meta[k]).trim();
  }
  return null;
}

function normalizeSponsoredRowFromSubscription(sub) {
  const meta = sub.metadata || {};

  const business_id =
    metaGet(meta, "business_id", "cleaner_id", "cleanerId", "businessId") || null;
  const area_id = metaGet(meta, "area_id", "areaId") || null;
  const category_id = metaGet(meta, "category_id", "categoryId") || null;

  const slotRaw = metaGet(meta, "slot") || "1";
  const slot = Number(slotRaw || 1) || 1;

  const stripe_customer_id =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null;

  // price / currency (best-effort; actual billing comes from Stripe invoice anyway)
  const currency = (sub.currency || metaGet(meta, "currency") || "gbp").toLowerCase();

  const current_period_end =
    sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;

  return {
    business_id,
    area_id,
    category_id,
    slot,
    stripe_customer_id,
    stripe_subscription_id: sub.id,
    price_monthly_pennies: subscription.items.data[0].price.unit_amount,
    currency,
    status: sub.status || null,
    current_period_end,
    // IMPORTANT: let DB fill geom only for blocking statuses (after you patch triggers)
    sponsored_geom: null,
    updated_at: new Date().toISOString(),
  };
}

async function upsertSubscriptionRow(sb, row) {
  // Use upsert to avoid “update then insert” races
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

    const stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      webhookSecret
    );

    const sb = getSupabaseAdmin();

    const type = stripeEvent.type;
    const obj = stripeEvent.data.object;

    // Log key events
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

    // ---- subscription events: upsert sponsored_subscriptions ----
    if (type.startsWith("customer.subscription.")) {
      const sub = obj;

      const row = normalizeSponsoredRowFromSubscription(sub);

      // Some events arrive without useful metadata; still upsert if we have sub id
      if (!row.stripe_subscription_id) return ok(200, { ok: true });

      // Attempt DB upsert
      const { data, error } = await upsertSubscriptionRow(sb, row);

      if (error) {
        console.error("[webhook] upsert sponsored_subscriptions error:", error, row);

        // If overlap/sold-out violation, cancel sub to stop billing
        if (isOverlapDbError(error)) {
          await safeCancelSubscription(sub.id, "Overlap/Sold-out violation");
          return ok(200, { ok: true, canceled: true });
        }

        // otherwise, surface but don't retry forever
        return ok(200, { ok: false, error: "DB write failed" });
      }

      return ok(200, { ok: true, wrote: true, id: data?.id || null });
    }

    // ---- invoice.paid: create invoice + email (only if accepted row exists) ----
    if (type === "invoice.paid") {
      const inv = obj;

      const subscriptionId =
        typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id || null;

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

    // Ignore other event types
    return ok(200, { ok: true });
  } catch (err) {
    console.error("[webhook] handler error:", err);
    // Stripe expects 2xx if you don't want retries. But for signature errors we should 400.
    const msg = String(err?.message || "");
    const isSig = msg.includes("No signatures found") || msg.includes("signature");
    return ok(isSig ? 400 : 200, { ok: false, error: msg });
  }
};
