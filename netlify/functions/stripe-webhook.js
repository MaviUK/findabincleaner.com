// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

console.log("LOADED stripe-webhook v2026-01-04-REMAINING-GEOM-RPC-FINAL");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const EPS = 1e-6;

// ---------- GeoJSON -> EWKT (SRID=4326;MULTIPOLYGON(...)) ----------
function ringToWkt(ring) {
  return ring.map((p) => `${p[0]} ${p[1]}`).join(", ");
}
function polygonToWkt(polyCoords) {
  const rings = polyCoords.map((ring) => `(${ringToWkt(ring)})`).join(", ");
  return `(${rings})`;
}
function geojsonToMultiPolygonWkt(gj) {
  if (!gj || !gj.type) return null;
  if (gj.type === "Polygon") {
    const poly = polygonToWkt(gj.coordinates);
    return `MULTIPOLYGON(${poly})`;
  }
  if (gj.type === "MultiPolygon") {
    const polys = gj.coordinates.map((polyCoords) => polygonToWkt(polyCoords)).join(", ");
    return `MULTIPOLYGON(${polys})`;
  }
  return null;
}
function ewkt4326FromGeojson(gj) {
  const wkt = geojsonToMultiPolygonWkt(gj);
  if (!wkt) return null;
  return `SRID=4326;${wkt}`;
}

// ---------- Helpers ----------
async function releaseLockIfPresent(lockId) {
  if (!lockId) return;
  try {
    await sb.from("sponsored_locks").update({ is_active: false }).eq("id", lockId);
  } catch (e) {
    console.warn("[webhook] failed to release lock", lockId, e?.message || e);
  }
}

async function cancelStripeSubscription(subId, reason) {
  if (!subId) return;
  try {
    // if already canceled/deleted, Stripe throws "No such subscription" -> ignore
    await stripe.subscriptions.cancel(subId);
    console.warn("[webhook] canceled subscription due to:", reason, subId);
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.includes("No such subscription")) {
      console.warn("[webhook] cancel skipped (already gone):", subId);
      return;
    }
    console.warn("[webhook] failed to cancel subscription", subId, msg);
  }
}

function pickMeta(obj) {
  const m = obj?.metadata || {};
  const business_id = m.business_id || m.cleaner_id || m.businessId || null;
  const area_id = m.area_id || m.areaId || null;
  const category_id = m.category_id || m.categoryId || null;
  const slot = Number(m.slot || 1);
  const lock_id = m.lock_id || null;
  return { business_id, area_id, category_id, slot, lock_id };
}

async function computeRemainingGeom(area_id, category_id, slot) {
  // ✅ single source of truth
  const { data, error } = await sb.rpc("area_remaining_preview", {
    p_area_id: area_id,
    p_category_id: category_id,
    p_slot: slot,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { soldOut: true, available_km2: 0, ewkt: null, geojson: null };

  const available_km2 = Number(row.available_km2 ?? 0);
  const soldOut =
    Boolean(row.sold_out) || !Number.isFinite(available_km2) || available_km2 <= EPS;

  const gj = row.gj ?? null;
  const ewkt = soldOut ? null : ewkt4326FromGeojson(gj);

  return { soldOut, available_km2: Math.max(0, available_km2 || 0), ewkt, geojson: gj };
}

async function upsertSponsoredRow({
  business_id,
  area_id,
  category_id,
  slot,
  stripe_customer_id,
  stripe_subscription_id,
  unit_amount_pennies,
  currency,
  status,
  current_period_end_iso,
  sponsored_geom_ewkt,
}) {
  const payload = {
    business_id,
    area_id,
    category_id,
    slot,
    stripe_customer_id,
    stripe_subscription_id,
    price_monthly_pennies: unit_amount_pennies,
    currency: (currency || "gbp")?.toLowerCase(),
    status,
    current_period_end: current_period_end_iso,
    // IMPORTANT: this must be the REMAINING region, not the full polygon
    sponsored_geom: sponsored_geom_ewkt,
  };

  const { error } = await sb
    .from("sponsored_subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  if (error) throw error;
}

// ---------- Main ----------
export default async (req) => {
  if (req.method === "GET") return json({ ok: true, note: "stripe-webhook deployed" });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ ok: false, error: "Missing STRIPE_WEBHOOK_SECRET" }, 500);

  let event;
  try {
    const raw = await req.text();
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    console.error("[stripe-webhook] signature error:", e?.message || e);
    return json({ ok: false, error: "Invalid signature" }, 400);
  }

  // Only these write sponsored_subscriptions
  const interesting = new Set([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    // optional: "customer.subscription.deleted",
  ]);

  try {
    const type = event.type;
    const obj = event.data.object;

    console.log(`[webhook] ${type} id=${event.id}`);

    if (!interesting.has(type)) return json({ ok: true, ignored: true });

    // 1) Resolve ids + metadata
    let subId = null;
    let custId = null;
    let currency = "gbp";
    let unit_amount = null;
    let current_period_end_iso = null;

    const meta = pickMeta(obj);
    const business_id = meta.business_id;
    const area_id = meta.area_id;
    const category_id = meta.category_id;
    const slot = meta.slot || 1;
    const lock_id = meta.lock_id;

    if (type === "checkout.session.completed") {
      const session = obj;

      subId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id || null;

      custId =
        typeof session.customer === "string" ? session.customer : session.customer?.id || null;

      // Expand line item price + subscription period end
      const full = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ["subscription", "line_items.data.price"],
      });

      currency = full.currency || session.currency || "gbp";
      unit_amount = full.line_items?.data?.[0]?.price?.unit_amount ?? null;

      const sub = typeof full.subscription === "string" ? null : full.subscription || null;
      current_period_end_iso =
        sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;

      if (!business_id || !area_id || !category_id || !subId || !custId) {
        await releaseLockIfPresent(lock_id);
        return json({ ok: true, skipped: "missing_required_metadata" }, 200);
      }

      // 2) Compute remaining geometry (truth)
      const rem = await computeRemainingGeom(area_id, category_id, slot);
      if (rem.soldOut || !rem.ewkt) {
        await cancelStripeSubscription(subId, "no_remaining_or_overlap");
        await releaseLockIfPresent(lock_id);
        return json({ ok: true, canceled: true, reason: "no_remaining" }, 200);
      }

      // 3) Upsert DB row
      try {
        await sb.rpc("upsert_sponsored_subscription_from_geojson", {
  p_business_id: business_id,
  p_area_id: area_id,
  p_category_id: category_id,
  p_slot: slot,
  p_stripe_customer_id: custId,
  p_stripe_subscription_id: subId,
  p_price_monthly_pennies: unit_amount,
  p_currency: currency,
  p_status: subscription.status || "active",
  p_current_period_end: current_period_end_iso,
  p_sponsored_geojson: rem.geojson, // ✅ direct from DB
});

      } catch (e) {
        console.warn("[webhook] DB upsert failed:", e?.code || "", e?.message || e);
        await cancelStripeSubscription(subId, "db_write_failed_or_overlap_trigger");
        await releaseLockIfPresent(lock_id);
        return json({ ok: true, canceled: true, reason: "db_write_failed" }, 200);
      }

      await releaseLockIfPresent(lock_id);
      return json({ ok: true });
    }

    // customer.subscription.created / updated
    const subscription = obj;
    subId = subscription.id;
    custId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id || null;

    currency = subscription.currency || "gbp";
    unit_amount = subscription.items?.data?.[0]?.price?.unit_amount ?? null;

    current_period_end_iso =
      subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null;

    if (!business_id || !area_id || !category_id || !subId || !custId) {
      await releaseLockIfPresent(lock_id);
      return json({ ok: true, skipped: "missing_metadata" }, 200);
    }

    const rem = await computeRemainingGeom(area_id, category_id, slot);
    if (rem.soldOut || !rem.ewkt) {
      await cancelStripeSubscription(subId, "no_remaining_or_overlap");
      await releaseLockIfPresent(lock_id);
      return json({ ok: true, canceled: true, reason: "no_remaining" }, 200);
    }

    try {
      await sb.rpc("upsert_sponsored_subscription_from_geojson", {
  p_business_id: business_id,
  p_area_id: area_id,
  p_category_id: category_id,
  p_slot: slot,
  p_stripe_customer_id: custId,
  p_stripe_subscription_id: subId,
  p_price_monthly_pennies: unit_amount,
  p_currency: currency,
  p_status: subscription.status || "active",
  p_current_period_end: current_period_end_iso,
  p_sponsored_geojson: rem.geojson, // ✅ direct from DB
});

    } catch (e) {
      console.warn("[webhook] DB upsert failed:", e?.code || "", e?.message || e);
      await cancelStripeSubscription(subId, "db_write_failed_or_overlap_trigger");
      await releaseLockIfPresent(lock_id);
      return json({ ok: true, canceled: true, reason: "db_write_failed" }, 200);
    }

    await releaseLockIfPresent(lock_id);
    return json({ ok: true });
  } catch (e) {
    console.error("[stripe-webhook] handler error:", e);
    // Always 200 so Stripe doesn’t retry storms while we cancel safely
    return json({ ok: true, handled_error: true }, 200);
  }
};
