// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

console.log("LOADED stripe-webhook v2026-01-04-REMAINING-GEOM-RPC-TRUTH");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const EPS = 1e-6;

// -------- GeoJSON -> WKT (Polygon + MultiPolygon) --------
function ringToWkt(ring) {
  // ring = [[lng,lat],...]
  return ring.map((p) => `${p[0]} ${p[1]}`).join(", ");
}

function polygonToWkt(polyCoords) {
  // polyCoords = [ ring1, ring2, ... ]
  const rings = polyCoords.map((ring) => `(${ringToWkt(ring)})`).join(", ");
  return `(${rings})`;
}

function geojsonToMultiPolygonWkt(gj) {
  if (!gj || !gj.type) return null;

  if (gj.type === "Polygon") {
    // Polygon -> MultiPolygon with 1 polygon
    const poly = polygonToWkt(gj.coordinates);
    return `MULTIPOLYGON(${poly})`;
  }

  if (gj.type === "MultiPolygon") {
    const polys = gj.coordinates.map((polyCoords) => polygonToWkt(polyCoords)).join(", ");
    return `MULTIPOLYGON(${polys})`;
  }

  // sometimes ST_AsGeoJSON returns GeometryCollection; we don't support that here
  return null;
}

function ewkt4326FromGeojson(gj) {
  const wkt = geojsonToMultiPolygonWkt(gj);
  if (!wkt) return null;
  return `SRID=4326;${wkt}`;
}

// -------- helpers --------
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
    await stripe.subscriptions.cancel(subId);
    console.warn("[webhook] canceled subscription due to:", reason, subId);
  } catch (e) {
    console.warn("[webhook] failed to cancel subscription", subId, e?.message || e);
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
  // ✅ single source of truth for “buyable” region
  const { data, error } = await sb.rpc("area_remaining_preview", {
    p_area_id: area_id,
    p_category_id: category_id,
    p_slot: slot,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { soldOut: true, available_km2: 0, ewkt: null, geojson: null };

  const available_km2 = Number(row.available_km2 ?? 0);
  const soldOut = Boolean(row.sold_out) || !Number.isFinite(available_km2) || available_km2 <= EPS;

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
    sponsored_geom: sponsored_geom_ewkt, // ✅ remaining multipolygon
  };

  const { error } = await sb
    .from("sponsored_subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  if (error) throw error;
}

// -------- main --------
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

  try {
    const type = event.type;
    const obj = event.data.object;

    console.log(`[webhook] ${type} id=${event.id}`);

    // We only write sponsored_subscriptions on these
    const interesting =
      type === "checkout.session.completed" ||
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated";

    if (!interesting) {
      return json({ ok: true, ignored: true });
    }

    // ---- Resolve subscription + customer ----
    let sub = null;
    let subId = null;
    let custId = null;
    let currency = "gbp";
    let unit_amount = null;

    if (type === "checkout.session.completed") {
      // session has subscription + customer
      const session = obj;
      currency = session.currency || "gbp";

      const meta = pickMeta(session);
      const business_id = meta.business_id;
      const area_id = meta.area_id;
      const category_id = meta.category_id;
      const slot = meta.slot || 1;
      const lock_id = meta.lock_id;

      subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id || null;
      custId = typeof session.customer === "string" ? session.customer : session.customer?.id || null;

      // expand to get price + period end
      const full = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ["subscription", "line_items.data.price"],
      });

      sub = typeof full.subscription === "string" ? null : full.subscription || null;

      unit_amount =
        full.line_items?.data?.[0]?.price?.unit_amount ??
        null;

      if (!business_id || !area_id || !category_id || !subId || !custId) {
        await releaseLockIfPresent(lock_id);
        return json({ ok: false, error: "Missing required metadata/subscription/customer" }, 200);
      }

      // ✅ compute remaining geometry (THE TRUTH)
      const rem = await computeRemainingGeom(area_id, category_id, slot);

      if (rem.soldOut || !rem.ewkt) {
        // no remaining -> cancel immediately so they are not charged monthly
        await cancelStripeSubscription(subId, "no_remaining_or_overlap");
        await releaseLockIfPresent(lock_id);
        return json({ ok: true, canceled: true, reason: "no_remaining" }, 200);
      }

      const current_period_end_iso =
        sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;

      try {
        await upsertSponsoredRow({
          business_id,
          area_id,
          category_id,
          slot,
          stripe_customer_id: custId,
          stripe_subscription_id: subId,
          unit_amount_pennies: unit_amount,
          currency,
          status: sub?.status || "active",
          current_period_end_iso,
          sponsored_geom_ewkt: rem.ewkt,
        });
      } catch (e) {
        // If DB overlap trigger fires, cancel subscription + release lock
        console.warn("[webhook] DB upsert failed:", e?.code || "", e?.message || e);
        await cancelStripeSubscription(subId, "db_overlap_trigger");
        await releaseLockIfPresent(lock_id);
        return json({ ok: true, canceled: true, reason: "db_write_failed" }, 200);
      }

      await releaseLockIfPresent(lock_id);
      return json({ ok: true });
    }

    // subscription.created/updated
    const subscription = obj;
    subId = subscription.id;
    custId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id || null;
    currency = subscription.currency || "gbp";
    unit_amount =
      subscription.items?.data?.[0]?.price?.unit_amount ??
      null;

    const meta = pickMeta(subscription);
    const business_id = meta.business_id;
    const area_id = meta.area_id;
    const category_id = meta.category_id;
    const slot = meta.slot || 1;
    const lock_id = meta.lock_id;

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

    const current_period_end_iso =
      subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null;

    try {
      await upsertSponsoredRow({
        business_id,
        area_id,
        category_id,
        slot,
        stripe_customer_id: custId,
        stripe_subscription_id: subId,
        unit_amount_pennies: unit_amount,
        currency,
        status: subscription.status || "active",
        current_period_end_iso,
        sponsored_geom_ewkt: rem.ewkt,
      });
    } catch (e) {
      console.warn("[webhook] DB upsert failed:", e?.code || "", e?.message || e);
      await cancelStripeSubscription(subId, "db_overlap_trigger");
      await releaseLockIfPresent(lock_id);
      return json({ ok: true, canceled: true, reason: "db_write_failed" }, 200);
    }

    await releaseLockIfPresent(lock_id);
    return json({ ok: true });
  } catch (e) {
    console.error("[stripe-webhook] handler error:", e);
    // Return 200 so Stripe doesn’t spam retries while we’re canceling safely
    return json({ ok: true, handled_error: true }, 200);
  }
};
