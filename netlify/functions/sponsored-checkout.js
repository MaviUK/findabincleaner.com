// netlify/functions/sponsored-checkout.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import area from "@turf/area";
import intersect from "@turf/intersect";
import difference from "@turf/difference";
import union from "@turf/union";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

function toFeature(geo) {
  if (!geo) return null;
  if (geo.type === "Feature") return geo;
  if (geo.type === "Polygon" || geo.type === "MultiPolygon") return { type: "Feature", geometry: geo, properties: {} };
  return null;
}
function unionMany(features) {
  if (!features.length) return null;
  let acc = features[0];
  for (let i = 1; i < features.length; i++) {
    try {
      acc = union(acc, features[i]) || acc;
    } catch {}
  }
  return acc;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const businessId = String(body.businessId || body.cleanerId || "").trim();
    const areaId = String(body.areaId || body.area_id || "").trim();
    const slot = 1;

    if (!businessId || !areaId) return json({ error: "Missing businessId or areaId" }, 400);

    // 1) Pull target area
    const { data: target, error: tErr } = await sb
      .from("service_areas")
      .select("gj")
      .eq("id", areaId)
      .maybeSingle();
    if (tErr || !target?.gj) return json({ error: "Area not found" }, 404);

    const targetF = toFeature(target.gj);
    if (!targetF) return json({ error: "Invalid area geometry" }, 400);

    // 2) Union of active Featured sponsorships by others ∩ target
    const { data: taken, error: sErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id, area_id, status, slot, area:service_areas(gj)")
      .eq("slot", slot);
    if (sErr) return json({ error: sErr.message || "Failed to query sponsorships" }, 500);

    const activeOthers = (taken || []).filter(
      (r) =>
        r?.area?.gj &&
        r.business_id &&
        r.business_id !== businessId &&
        BLOCKING.has(String(r.status || "").toLowerCase())
    );

    const overlaps = [];
    for (const r of activeOthers) {
      const otherF = toFeature(r.area.gj);
      if (!otherF) continue;
      try {
        const ov = intersect(otherF, targetF);
        if (ov) overlaps.push(ov);
      } catch {}
    }
    const occupied = overlaps.length ? unionMany(overlaps) : null;

    let remaining = null;
    if (!occupied) remaining = targetF;
    else {
      try {
        remaining = difference(targetF, occupied) || null;
      } catch {
        remaining = null;
      }
    }

    const remaining_km2 = remaining ? area(remaining) / 1_000_000 : 0;
    if (!remaining || remaining_km2 <= 0) {
      // Another business already covers (all of) this polygon
      return json({ error: "Sold out for this coverage" }, 409);
    }

    // 3) Price (safe fallbacks)
    const rate =
      Number(process.env.RATE_PER_KM2_PER_MONTH) ||
      Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH) ||
      1;
    const minMonthly = Number(process.env.MIN_PRICE_PER_MONTH) || Number(process.env.MIN_GOLD_PRICE_PER_MONTH) || 1;

    const raw = Math.max(0, remaining_km2 * rate);
    const monthlyMajor = Math.max(minMonthly, raw);
    const monthlyCents = Math.round(monthlyMajor * 100);
    if (!monthlyCents) return json({ error: "Calculated amount must be > 0" }, 400);

    // 4) Ensure Stripe customer
    let customerId = null;
    const { data: biz, error: bizErr } = await sb
      .from("businesses")
      .select("stripe_customer_id")
      .eq("id", businessId)
      .maybeSingle();
    if (bizErr) console.warn("Fetch stripe_customer_id error:", bizErr);
    if (biz?.stripe_customer_id) {
      customerId = biz.stripe_customer_id;
    } else {
      const cust = await stripe.customers.create({ metadata: { business_id: businessId } });
      customerId = cust.id;
      await sb.from("businesses").update({ stripe_customer_id: customerId }).eq("id", businessId);
    }

    const site = process.env.PUBLIC_SITE_URL || "http://localhost:8888";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId || undefined,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: "Featured Sponsorship",
              description: "First in local search for this service area.",
            },
            recurring: { interval: "month" },
            unit_amount: monthlyCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${site}/#/dashboard?checkout=success`,
      cancel_url: `${site}/#/dashboard?checkout=cancel`,
      metadata: {
        business_id: businessId,
        area_id: areaId,
        slot: String(slot),
      },
      allow_promotion_codes: true,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("sponsored-checkout error:", e);
    return json({ error: e?.message || "Server error" }, 500);
  }
};
