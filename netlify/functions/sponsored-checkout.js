import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import * as turf from "@turf/turf";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Hard-blocking statuses per spec
const HARD_BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);
// minutes to treat `incomplete` as a temporary hold
const HOLD_MINUTES = Number(process.env.INCOMPLETE_HOLD_MINUTES || 35);
// small epsilon to avoid rounding noise
const EPS_KM2 = 1e-5;

function isBlockingRow(row) {
  const s = String(row?.status || "").toLowerCase();
  if (HARD_BLOCKING.has(s)) return true;
  if (s === "incomplete") {
    const ts = row?.created_at ? new Date(row.created_at).getTime() : 0;
    const ageMin = (Date.now() - ts) / 60000;
    return ageMin <= HOLD_MINUTES;
  }
  return false;
}

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
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const areaId = body?.areaId || body?.area_id;
  const slot = Number(body?.slot);
  const businessId = body?.businessId || body?.cleanerId;
  const previewId = body?.previewId || null;

  if (!areaId || !Number.isInteger(slot) || !businessId) {
    return json({ error: "Missing areaId, slot, or businessId" }, 400);
  }

  try {
    // Re-run server-side preview with the same logic

    // 1) Area geometry
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

    // 2) Current subs (need created_at for time-boxed `incomplete`)
    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("status, final_geojson, business_id, created_at")
      .eq("area_id", areaId)
      .eq("slot", slot);
    if (subsErr) throw subsErr;

    const blockers = (subs || []).filter(isBlockingRow);

    // Whole-slot block if any blocking row lacks final geometry
    if (blockers.some((b) => !b.final_geojson)) {
      return json({ error: "No purchasable area left for this slot." }, 409);
    }

    // Subtract blocking final geometries (union not necessary, iterative diff is fine)
    let available = base;
    for (const b of blockers) {
      const g = b.final_geojson;
      if (!g) continue;
      let blockGeom;
      if (g.type === "Polygon") blockGeom = turf.multiPolygon([g.coordinates]);
      else if (g.type === "MultiPolygon") blockGeom = turf.multiPolygon(g.coordinates);
      else continue;

      try {
        available = turf.difference(available, blockGeom) || turf.multiPolygon([]);
      } catch (e) {
        console.error("Geometry difference failed:", e);
        return json({ error: "Geometry difference failed" }, 400);
      }
    }

    const km2 = turf.area(available) / 1e6;
    if (km2 <= EPS_KM2) {
      return json({ error: "No purchasable area left for this slot." }, 409);
    }

    // 3) Price
    const monthly = Math.max(km2 * rateForSlot(slot), minForSlot(slot));
    const unitAmount = Math.round(monthly * 100); // pence

    // 4) Stripe Checkout
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
        preview_id: previewId || "",
        km2: km2.toFixed(6),
      },
    });

    return json({ url: session.url });
  } catch (err) {
    console.error("sponsored-checkout error:", err);
    return json({ error: "Checkout error" }, 500);
  }
};
