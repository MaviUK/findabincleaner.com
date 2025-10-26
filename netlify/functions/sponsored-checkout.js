// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import * as turf from "@turf/turf";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

function ensureMultiPolygon(gj) {
  if (!gj) return null;
  if (gj.type === "Feature") return ensureMultiPolygon(gj.geometry);
  if (gj.type === "FeatureCollection") return ensureMultiPolygon(gj.features?.[0]?.geometry);
  if (gj.type === "MultiPolygon") return gj;
  if (gj.type === "Polygon") return { type: "MultiPolygon", coordinates: [gj.coordinates] };
  return null;
}
const F = (g) => ({ type: "Feature", properties: {}, geometry: g });

const num = (v, fb) => (v != null && v !== "" ? Number(v) : fb);
function priceFor(slot, km2) {
  const base = num(process.env.RATE_PER_KM2_PER_MONTH, 1);
  const minBase = num(process.env.MIN_PRICE_PER_MONTH, 1);
  const perSlot = {
    1: num(process.env.RATE_GOLD_PER_KM2_PER_MONTH, base),
    2: num(process.env.RATE_SILVER_PER_KM2_PER_MONTH, base),
    3: num(process.env.RATE_BRONZE_PER_KM2_PER_MONTH, base),
  };
  const minPerSlot = {
    1: num(process.env.MIN_GOLD_PRICE_PER_MONTH, minBase),
    2: num(process.env.MIN_SILVER_PRICE_PER_MONTH, minBase),
    3: num(process.env.MIN_BRONZE_PRICE_PER_MONTH, minBase),
  };
  const variable = km2 * perSlot[slot];
  return Math.max(variable, minPerSlot[slot]);
}

async function computePreview({ businessId, areaId, slot }) {
  // load area
  const { data: areaRow, error: areaErr } = await sb
    .from("service_areas")
    .select("id, gj")
    .eq("id", areaId)
    .single();
  if (areaErr) throw areaErr;

  const areaMP = ensureMultiPolygon(areaRow?.gj);
  if (!areaMP) return { km2: 0, amount: 0, geom: null };

  let available = F(areaMP);

  // blocking winners
  const { data: subs, error: subErr } = await sb
    .from("sponsored_subscriptions")
    .select("business_id, status, final_geojson")
    .eq("area_id", areaId)
    .eq("slot", slot);
  if (subErr) throw subErr;

  let blocker = null;
  for (const s of subs || []) {
    if (s.business_id === businessId) continue;
    if (!BLOCKING.has(s.status)) continue;
    const mp = ensureMultiPolygon(s.final_geojson) || areaMP;
    blocker = blocker ? turf.union(blocker, F(mp)) : F(mp);
  }
  if (blocker) {
    try {
      const diff = turf.difference(available, blocker);
      available = diff && diff.geometry && (diff.geometry.coordinates?.length ?? 0) > 0 ? diff : null;
    } catch {
      available = null;
    }
  }

  let km2 = 0;
  if (available) {
    try {
      km2 = turf.area(available) / 1_000_000;
    } catch {
      km2 = 0;
    }
  }
  const monthly = km2 > 0 ? priceFor(slot, km2) : 0;

  return {
    km2: Number(km2.toFixed(4)),
    amount: monthly ? Number(monthly.toFixed(2)) : 0,
    geom: available?.geometry ?? null,
  };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const businessId = body?.businessId || body?.cleanerId;
  const areaId = body?.areaId || body?.area_id;
  const slot = [1, 2, 3].includes(Number(body?.slot)) ? Number(body.slot) : null;

  if (!businessId || !areaId || !slot) {
    return json({ error: "businessId/cleanerId, areaId, slot required" }, 400);
  }

  try {
    // Re-check availability + compute price
    const preview = await computePreview({ businessId, areaId, slot });
    if (!preview || preview.km2 <= 0 || preview.amount <= 0) {
      return json({ error: "Slot already taken or no purchasable area." }, 409);
    }

    const amountInMinor = Math.round(preview.amount * 100); // GBP -> pence

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `Sponsor Slot #${slot} — Area ${areaId}`,
              metadata: { area_id: areaId, slot: String(slot) },
            },
            recurring: { interval: "month" },
            unit_amount: amountInMinor,
          },
          quantity: 1,
        },
      ],
      metadata: {
        business_id: businessId,
        area_id: areaId,
        slot: String(slot),
      },
      success_url: `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=success`,
      cancel_url: `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=cancel`,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("[sponsored-checkout] error:", e);
    return json({ error: "Checkout failed" }, 502);
  }
};
