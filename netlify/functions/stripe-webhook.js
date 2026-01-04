// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

console.log("LOADED stripe-webhook v2026-01-04-REMAINING-GEOM-MULTI");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const BLOCKING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function releaseLockSafe(lockId) {
  if (!lockId) return;
  try {
    await supabase.from("sponsored_locks").update({ is_active: false }).eq("id", lockId);
  } catch (e) {
    console.error("[webhook] failed to release lock:", lockId, e?.message || e);
  }
}

// GeoJSON -> EWKT with MultiPolygon safety
function geojsonToEwktMulti(geojson) {
  if (!geojson) return null;
  const t = geojson.type;

  // If Polygon => wrap into MultiPolygon
  const safe =
    t === "Polygon"
      ? { type: "MultiPolygon", coordinates: [geojson.coordinates] }
      : geojson;

  if (safe.type !== "MultiPolygon") return null;

  // EWKT: SRID=4326;MULTIPOLYGON(((lng lat, ...)),((...)))
  const polys = safe.coordinates
    .map((poly) => {
      const rings = poly
        .map((ring) => {
          const pts = ring.map(([lng, lat]) => `${lng} ${lat}`).join(",");
          return `(${pts})`;
        })
        .join(",");
      return `(${rings})`;
    })
    .join(",");

  return `SRID=4326;MULTIPOLYGON(${polys})`;
}

async function computeRemaining(area_id, category_id, slot) {
  const { data, error } = await supabase.rpc("area_remaining_preview", {
    p_area_id: area_id,
    p_category_id: category_id,
    p_slot: slot,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { sold_out: true, available_km2: 0, geojson: null };

  return {
    sold_out: Boolean(row.sold_out),
    available_km2: Number(row.available_km2 ?? 0) || 0,
    geojson: row.gj ?? null,
    total_km2: Number(row.total_km2 ?? 0) || 0,
    reason: row.reason ?? null,
  };
}

async function upsertSubscriptionFromSession(session, subObj) {
  const meta = session.metadata || {};

  const business_id =
    meta.business_id || meta.cleaner_id || meta.cleanerId || meta.businessId || null;
  const area_id = meta.area_id || meta.areaId || null;
  const category_id = meta.category_id || meta.categoryId || null;
  const slot = Number(meta.slot || 1);
  const lock_id = meta.lock_id || null;

  const subId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id || null;

  const custId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id || null;

  if (!business_id || !area_id || !category_id || !subId || !custId) {
    await releaseLockSafe(lock_id);
    return { ok: false, error: "missing_metadata", got: { business_id, area_id, category_id, slot, subId, custId } };
  }

  // Compute remaining geometry NOW (this is what prevents overlap failures)
  const rem = await computeRemaining(area_id, category_id, slot);

  // If sold out at webhook time, we cannot write (race condition)
  if (rem.sold_out || rem.available_km2 <= 1e-6 || !rem.geojson) {
    console.warn("[webhook] no remaining at finalize time; lock will be released.", {
      business_id,
      area_id,
      category_id,
      slot,
      stripe_subscription_id: subId,
    });

    await releaseLockSafe(lock_id);

    // OPTIONAL: cancel subscription so customer isn't charged
    // await stripe.subscriptions.cancel(subId).catch(() => null);

    return { ok: true, prevented: "no_remaining" };
  }

  const ewktMulti = geojsonToEwktMulti(rem.geojson);
  if (!ewktMulti) {
    console.warn("[webhook] remaining geojson not multipolygon-compatible; lock will be released.", {
      business_id,
      area_id,
      category_id,
      slot,
      stripe_subscription_id: subId,
    });
    await releaseLockSafe(lock_id);
    // OPTIONAL cancel
    // await stripe.subscriptions.cancel(subId).catch(() => null);
    return { ok: true, prevented: "bad_geojson" };
  }

  // price (from line_items is best)
  const unitAmount =
    session.line_items?.data?.[0]?.price?.unit_amount ?? null;

  const currentPeriodEndIso =
    subObj?.current_period_end
      ? new Date(subObj.current_period_end * 1000).toISOString()
      : null;

  // status
  const status = String(subObj?.status || session?.status || "active").toLowerCase();

  // Write: IMPORTANT -> include sponsored_geom as EWKT MultiPolygon
  const payload = {
    business_id,
    area_id,
    category_id,
    slot,
    stripe_customer_id: custId,
    stripe_subscription_id: subId,
    price_monthly_pennies: unitAmount,
    currency: (session.currency || "gbp")?.toLowerCase(),
    status,
    current_period_end: currentPeriodEndIso,

    // ✅ THIS is the key: store the purchasable/remaining region, not the whole area
    sponsored_geom: ewktMulti,
  };

  // Try write; if overlap blocks, release lock and optionally cancel sub
  const { error } = await supabase
    .from("sponsored_subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  if (error) {
    const msg = error?.message || "";

    // overlap grace: accept webhook, release lock, optionally cancel
    if (msg.includes("overlaps an existing sponsored area") || error.code === "23505") {
      console.warn("[webhook] overlap prevented DB write; lock will be released.", {
        business_id,
        area_id,
        category_id,
        slot,
        stripe_subscription_id: subId,
      });
      await releaseLockSafe(lock_id);
      // OPTIONAL cancel:
      // await stripe.subscriptions.cancel(subId).catch(() => null);
      return { ok: true, prevented: "overlap" };
    }

    // geometry mismatch / missing geometry
    if (msg.includes("has no geometry") || msg.includes("does not match column type")) {
      console.error("[stripe-webhook] DB upsert failed:", error);
      await releaseLockSafe(lock_id);
      // OPTIONAL cancel:
      // await stripe.subscriptions.cancel(subId).catch(() => null);
      return { ok: true, prevented: "geom_write_failed" };
    }

    console.error("[stripe-webhook] DB upsert failed:", error);
    await releaseLockSafe(lock_id);
    return { ok: false, error: "db_write_failed", detail: error };
  }

  await releaseLockSafe(lock_id);
  return { ok: true };
}

export default async (req) => {
  if (req.method === "GET") {
    return json({ ok: true, note: "stripe-webhook deployed. POST from Stripe only." }, 200);
  }
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const sig = req.headers.get("stripe-signature");
  const whsec = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !whsec) return json({ ok: false, error: "Missing Stripe signature/secret" }, 400);

  let raw;
  try {
    raw = await req.text();
  } catch {
    return json({ ok: false, error: "Missing raw body" }, 400);
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, whsec);
  } catch (err) {
    console.error("[webhook] signature verify failed:", err?.message || err);
    return json({ ok: false, error: "Bad signature" }, 400);
  }

  try {
    const type = event.type;
    const obj = event.data.object;

    // We only need to upsert on these core events
    if (type === "checkout.session.completed") {
      console.log(`[webhook] ${type} id=${event.id}`);

      // expand sub + line items for reliable price + period_end
      const session = await stripe.checkout.sessions.retrieve(obj.id, {
        expand: ["subscription", "customer", "line_items.data.price"],
      });

      const subObj = typeof session.subscription === "string" ? null : session.subscription;
      const res = await upsertSubscriptionFromSession(session, subObj);
      return json({ ok: true, handled: type, res }, 200);
    }

    if (type.startsWith("customer.subscription.")) {
      console.log(`[webhook] ${type} id=${event.id}`);

      const sub = obj;
      const meta = sub.metadata || {};

      // Only process if it looks like OUR product
      const area_id = meta.area_id || null;
      const category_id = meta.category_id || null;
      if (!area_id || !category_id) {
        return json({ ok: true, handled: type, skipped: "no_meta" }, 200);
      }

      // Fetch a session-like object? We don’t always have it here.
      // We can just upsert status/period_end; geometry stays from checkout insert.
      const payload = {
        stripe_subscription_id: sub.id,
        status: String(sub.status || "").toLowerCase(),
        current_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
      };

      const { error } = await supabase
        .from("sponsored_subscriptions")
        .update(payload)
        .eq("stripe_subscription_id", sub.id);

      if (error) {
        console.warn("[webhook] subscription status update failed (non-fatal):", error);
      }

      return json({ ok: true, handled: type }, 200);
    }

    // ignore others
    return json({ ok: true, ignored: event.type }, 200);
  } catch (e) {
    console.error("[stripe-webhook] handler error:", e);
    // still 200 to avoid Stripe retry storms for non-critical failures
    return json({ ok: true, error: e?.message || "handler_failed" }, 200);
  }
};
