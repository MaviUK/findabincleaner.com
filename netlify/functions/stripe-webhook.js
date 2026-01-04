import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

console.log("LOADED stripe-webhook v2026-01-03-GEOM-SAFE+OVERLAP-GRACE");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const json = (statusCode, body) =>
  ({
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * IMPORTANT:
 * - Stripe sends the webhook body as raw text. Netlify provides it in event.body.
 * - You must pass raw body to constructEvent for signature verification.
 */
function getRawBody(event) {
  // Netlify sometimes gives base64 encoded body depending on config
  if (event.isBase64Encoded) {
    return Buffer.from(event.body || "", "base64").toString("utf8");
  }
  return event.body || "";
}

async function releaseLockSafe(lockId) {
  if (!lockId) return;
  try {
    await supabase.from("sponsored_locks").update({ is_active: false }).eq("id", lockId);
  } catch (e) {
    console.error("[webhook] failed to release lock:", lockId, e?.message || e);
  }
}

function normalizeStatus(s) {
  return String(s || "").toLowerCase();
}

/**
 * Pull sponsorship metadata from Stripe object (subscription or checkout session)
 * Your system uses these metadata keys across functions:
 * business_id, area_id, category_id, slot, lock_id
 */
function readSponsorshipMeta(meta = {}) {
  const business_id =
    meta.business_id || meta.cleaner_id || meta.cleanerId || meta.businessId || null;

  const area_id = meta.area_id || meta.areaId || null;
  const category_id = meta.category_id || meta.categoryId || null;
  const slot = Number(meta.slot || 1);

  const lock_id = meta.lock_id || meta.lockId || null;

  return { business_id, area_id, category_id, slot, lock_id };
}

/**
 * Fetch service area geometry (PostGIS) as GeoJSON so we can store something safe.
 * BUT: your DB wants MultiPolygon — so we normalize with a SQL RPC call (recommended),
 * or we rely on a DB trigger to fill sponsored_geom.
 *
 * If you already have a DB trigger `sponsored_subscriptions_fill_geom()` that fills
 * sponsored_geom, you can omit sending geometry entirely. However, you previously
 * hit "has no geometry" so we ensure it can be set.
 *
 * NOTE: This code assumes service_areas.geom exists (geometry column).
 */
async function fetchServiceAreaGeoJSON(area_id) {
  const { data, error } = await supabase
    .from("service_areas")
    .select("id, geom")
    .eq("id", area_id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // geom comes as PostGIS geometry object in supabase? depends on your config.
  // safest: have a SQL RPC that returns ST_AsGeoJSON(geom)::jsonb.
  // If you already have such RPC, use it instead.
  return null;
}

/**
 * If your DB trigger fills sponsored_geom, you can leave sponsored_geom null,
 * BUT you must ensure the trigger can compute it (and not raise "no geometry").
 *
 * From your error: trigger trg_block_sponsorship_overlap raises if sponsored_geom is null.
 * That means your fill trigger must run BEFORE overlap trigger, or overlap trigger
 * must tolerate null during early lifecycle.
 *
 * Since you have:
 * - trg_sponsored_subscriptions_fill_geom BEFORE INSERT OR UPDATE
 * - sponsored_subscriptions_no_overlap BEFORE INSERT OR UPDATE OF sponsored_geom, status, category_id, slot
 *
 * The overlap trigger should see sponsored_geom after fill trigger IF ordering is correct.
 * Postgres trigger ordering for same timing is name order. So ensure fill trigger name sorts earlier.
 *
 * This webhook keeps insert minimal and relies on your fill trigger.
 */
async function upsertSponsoredSubscription({
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
}) {
  const payload = {
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
  };

  const { error } = await supabase
    .from("sponsored_subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  if (error) throw error;
}

function isOverlapError(e) {
  const code = e?.code || e?.cause?.code;
  const msg = String(e?.message || "");
  // You’ve seen:
  // - 23505 unique/constraint with message "Area overlaps..."
  // - custom exceptions with P0001 messages
  // Treat either as overlap-ish
  return code === "23505" || msg.toLowerCase().includes("overlaps an existing sponsored area");
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json(200, { ok: true, note: "Use POST (Stripe webhook)." });
  }
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !endpointSecret) {
    return json(400, { ok: false, error: "Missing stripe signature/secret" });
  }

  let stripeEvent;
  try {
    const rawBody = getRawBody(event);
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err) {
    console.error("[stripe-webhook] signature verify failed:", err?.message || err);
    return json(400, { ok: false, error: "Invalid signature" });
  }

  const type = stripeEvent.type;
  const obj = stripeEvent.data.object;

  try {
    // We only need to write sponsored_subscriptions on subscription lifecycle.
    // You can add/adjust event types here.
    const relevant = new Set([
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.paid",
    ]);

    if (!relevant.has(type)) {
      return json(200, { ok: true, ignored: type });
    }

    // ---- Pull core sponsorship metadata ----
    // checkout.session.completed: meta on session
    // subscription events: meta on subscription
    let meta = obj?.metadata || {};
    let subscriptionId = null;
    let customerId = null;
    let status = null;
    let currentPeriodEndIso = null;
    let priceMonthlyPennies = null;
    let currency = (obj?.currency || "gbp")?.toLowerCase();

    if (type === "checkout.session.completed") {
      const session = obj;
      subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      status = "active";

      // Best effort: expand subscription to get period end if you want
      // (optional, but helpful)
      if (subscriptionId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          currentPeriodEndIso = sub?.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null;
          status = normalizeStatus(sub?.status) || status;
          // subscription metadata tends to match checkout metadata
          meta = { ...meta, ...(sub?.metadata || {}) };
        } catch {}
      }

      // You previously relied on line_items for price; keep it simple:
      // If you want exact unit amount, you can retrieve the session expanded, but that’s slower.
      // This may remain null and you can derive price later from plan/price.
      priceMonthlyPennies = null;
      currency = (session.currency || currency || "gbp")?.toLowerCase();
    } else if (type.startsWith("customer.subscription.")) {
      const sub = obj;
      subscriptionId = sub.id;
      customerId = sub.customer;
      status = normalizeStatus(sub.status) || null;
      currentPeriodEndIso = sub?.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;
      meta = sub?.metadata || meta;
      currency = currency || "gbp";
    } else if (type === "invoice.paid") {
      // You said you only want paid-only notifications; keep invoice handling minimal here
      return json(200, { ok: true, handled: "invoice.paid" });
    }

    const { business_id, area_id, category_id, slot, lock_id } = readSponsorshipMeta(meta);

    // If missing core meta, just acknowledge webhook (don’t retry forever)
    if (!business_id || !area_id || !category_id || !subscriptionId || !customerId) {
      console.warn("[webhook] missing required sponsorship metadata; skipping write", {
        type,
        business_id,
        area_id,
        category_id,
        slot,
        subscriptionId,
        customerId,
      });
      await releaseLockSafe(lock_id);
      return json(200, { ok: true, skipped: "missing-metadata" });
    }

    // If subscription deleted, mark canceled (optional)
    if (type === "customer.subscription.deleted") {
      const { error } = await supabase
        .from("sponsored_subscriptions")
        .update({ status: "canceled" })
        .eq("stripe_subscription_id", subscriptionId);

      if (error) console.error("[webhook] failed to mark canceled:", error);
      await releaseLockSafe(lock_id);
      return json(200, { ok: true, canceled: true });
    }

    // ---- Upsert subscription row ----
    try {
      await upsertSponsoredSubscription({
        business_id,
        area_id,
        category_id,
        slot: Number(slot || 1),
        stripe_customer_id: String(customerId),
        stripe_subscription_id: String(subscriptionId),
        price_monthly_pennies: priceMonthlyPennies,
        currency,
        status: status || "active",
        current_period_end: currentPeriodEndIso,
      });

      // Release lock after successful write
      await releaseLockSafe(lock_id);

      return json(200, {
        ok: true,
        type,
        business_id,
        area_id,
        category_id,
        slot,
        stripe_subscription_id: subscriptionId,
      });
    } catch (e) {
      // ✅ OVERLAP GRACE: if DB blocks overlap, do not hard-fail webhook
      if (isOverlapError(e)) {
        console.warn("[webhook] overlap prevented DB write; lock will be released.", {
          business_id,
          area_id,
          category_id,
          slot,
          stripe_subscription_id: subscriptionId,
        });
        await releaseLockSafe(lock_id);
        return json(200, { ok: true, overlap: true });
      }

      console.error("[stripe-webhook] DB upsert failed:", e);
      await releaseLockSafe(lock_id);
      return json(500, { ok: false, error: "DB write failed" });
    }
  } catch (err) {
    console.error("[stripe-webhook] handler error:", err);
    // never leave locks hanging if we can help it
    try {
      const meta = stripeEvent?.data?.object?.metadata || {};
      const { lock_id } = readSponsorshipMeta(meta);
      await releaseLockSafe(lock_id);
    } catch {}
    return json(500, { ok: false, error: err?.message || "Webhook failed" });
  }
};
