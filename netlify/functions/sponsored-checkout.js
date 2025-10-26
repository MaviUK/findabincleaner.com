import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import * as turf from "@turf/turf";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Only these statuses block, exactly as spec + preview.
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);
const isBlocking = (s) => BLOCKING.has(String(s || "").toLowerCase());

// Tiny epsilon to avoid float noise
const EPS_KM2 = 1e-5;

function rateForSlot(slot) {
  const base = Number(process.env.RATE_PER_KM2_PER_MONTH || 1);
  const perSlot = {
    1: Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH || base),
    2: Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH || base),
    3: Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH || base),
  };
  return perSlot[slot] || base;
}
function minForSlot(slot) {
  const base = Number(process.env.MIN_PRICE_PER_MONTH || 1);
  const perSlot = {
    1: Number(process.env.MIN_GOLD_PRICE_PER_MONTH || base),
    2: Number(process.env.MIN_SILVER_PRICE_PER_MONTH || base),
    3: Number(process.env.MIN_BRONZE_PRICE_PER_MONTH || base),
  };
  return perSlot[slot] || base;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const areaId = body?.areaId;
  const slot = Number(body?.slot);
  const businessId = body?.businessId;
  if (!areaId || !Number.isInteger(slot) || !businessId) {
    return json({ error: "Missing areaId, slot, or businessId" }, 400);
  }

  try {
    // 1) Load area geometry
    const { data: areaRow, error: areaErr } = await sb
      .from("service_areas")
      .select("gj")
      .eq("id", areaId)
      .maybeSingle();
    if (areaErr) throw areaErr;
    if (!areaRow?.gj) return json({ error: "Area not found" }, 404);

    let base;
    const gj = areaRow.gj;
    if (gj.type === "Polygon") base = turf.multiPolygon([gj.coordinates]);
    else if (gj.type === "MultiPolygon") base = turf.multiPolygon(gj.coordinates);
    else return json({ error: "Area geometry must be Polygon or MultiPolygon" }, 400);

    // 2) Load subs for (area, slot)
    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("status, business_id, final_geojson")
      .eq("area_id", areaId)
      .eq("slot", slot);
    if (subsErr) throw subsErr;

    const blockers = (subs || []).filter((s) => isBlocking(s.status));

    // a) If any blocking winner lacks final_geojson → whole slot blocked
    if (blockers.some((b) => !b.final_geojson && b.business_id !== businessId)) {
      return json({ error: `Slot #${slot} is fully blocked.` }, 409);
    }

    // b) Subtract union of all blockers' final_geojson (excluding my own rows)
    let unionBlock = null;
    for (const b of blockers) {
      if (!b.final_geojson || b.business_id === businessId) continue;
      const g = b.final_geojson;
      const geom = g.type === "Polygon" ? turf.multiPolygon([g.coordinates])
                 : g.type === "MultiPolygon" ? turf.multiPolygon(g.coordinates)
                 : null;
      if (!geom) continue;
      unionBlock = unionBlock ? turf.union(unionBlock, geom) : geom;
    }

    let available = base;
    if (unionBlock) {
      try {
        available = turf.difference(base, unionBlock) || turf.multiPolygon([]);
      } catch (e) {
        console.error("difference failed:", e);
        return json({ error: "Geometry difference failed" }, 400);
      }
    }

    const km2 = turf.area(available) / 1e6;
    if (km2 <= EPS_KM2) {
      return json({ error: "No purchasable area left for this slot." }, 409);
    }

    // 3) Price
    const monthly = Math.max(km2 * rateForSlot(slot), minForSlot(slot));
    const unitAmount = Math.round(monthly * 100);

    // 4) Create Stripe Checkout
    const successUrl = `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=success`;
    const cancelUrl = `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `Sponsored Area — Slot ${slot}`,
              description: "Monthly sponsorship of your chosen sub-region.",
            },
            recurring: { interval: "month" },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        area_id: areaId,
        slot: String(slot),
        business_id: businessId,
        // you can also store km2 or preview_id if you want
      },
    });

    return json({ url: session.url });
  } catch (err) {
    console.error("sponsored-checkout error:", err);
    return json({ error: "Checkout error" }, 500);
  }
};
