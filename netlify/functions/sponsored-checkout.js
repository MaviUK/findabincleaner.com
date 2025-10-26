// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import * as turf from "@turf/turf";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

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

// geometry helpers (same as preview)
function toMulti(g) {
  if (!g) return null;
  if (g.type === "Polygon") return turf.multiPolygon([g.coordinates]);
  if (g.type === "MultiPolygon") return turf.multiPolygon(g.coordinates);
  return null;
}
function sanitize(mp) {
  try { mp = turf.cleanCoords(mp); } catch {}
  try { mp = turf.rewind(mp, { reverse: false }); } catch {}
  return mp;
}
function safeDiff(a, b) {
  try {
    const d = turf.difference(a, b);
    return d ? d : turf.multiPolygon([]);
  } catch {
    return turf.multiPolygon([]); // conservative
  }
}
function areaKm2(geom) {
  try {
    return turf.area(geom) / 1e6;
  } catch {
    return 0;
  }
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
  if (!areaId || !Number.isInteger(slot) || !businessId) {
    return json({ error: "Missing areaId, slot, or businessId" }, 400);
  }

  try {
    // Re-run the safe preview logic server-side
    const { data: areaRow, error: areaErr } = await sb
      .from("service_areas")
      .select("id, gj")
      .eq("id", areaId)
      .maybeSingle();
    if (areaErr) throw areaErr;
    if (!areaRow?.gj) return json({ error: "Area not found" }, 404);

    let base = toMulti(areaRow.gj);
    if (!base) return json({ error: "Invalid area geometry" }, 400);
    base = sanitize(base);

    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("status, final_geojson")
      .eq("area_id", areaId)
      .eq("slot", slot);
    if (subsErr) throw subsErr;

    const blockers = (subs || []).filter((s) => BLOCKING.has(s.status));
    if (blockers.some((b) => !b.final_geojson)) {
      return json({ error: "No purchasable area left for this slot." }, 400);
    }

    let available = base;
    for (const b of blockers) {
      const bg = sanitize(toMulti(b.final_geojson));
      if (!bg) continue;
      available = safeDiff(available, bg);
    }

    const km2 = areaKm2(available);
    if (!(km2 > 0)) return json({ error: "No purchasable area left for this slot." }, 400);

    const rate = rateForSlot(slot);
    const min = minForSlot(slot);
    const monthly = Math.max(km2 * rate, min);
    const unitAmount = Math.round(monthly * 100);

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
        km2: km2.toFixed(6),
      },
    });

    return json({ url: session.url });
  } catch (err) {
    console.error("sponsored-checkout error:", err);
    // Don’t allow ambiguous purchases
    return json({ error: "No purchasable area left for this slot." }, 400);
  }
};
