// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import * as turf from "@turf/turf";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);
const km2 = (m2) => (Number.isFinite(m2) ? m2 / 1_000_000 : 0);

function toMultiPolygonFeature(geo) {
  if (!geo) return null;
  let g = geo;
  if (g.type === "Feature") g = g.geometry;
  if (g.type === "FeatureCollection") {
    const polys = g.features
      .map((f) => (f.type === "Feature" ? f.geometry : f))
      .filter((gg) => gg && (gg.type === "Polygon" || gg.type === "MultiPolygon"));
    if (!polys.length) return null;
    let cur = turf.feature(polys[0]);
    for (let i = 1; i < polys.length; i++) {
      try {
        cur = turf.union(cur, turf.feature(polys[i])) || cur;
      } catch {}
    }
    g = cur.geometry;
  }
  if (g.type === "Polygon") return turf.multiPolygon([g.coordinates]);
  if (g.type === "MultiPolygon") return turf.multiPolygon(g.coordinates);
  return null;
}

function unionAll(features) {
  if (!features.length) return null;
  let cur = features[0];
  for (let i = 1; i < features.length; i++) {
    try {
      const u = turf.union(cur, features[i]);
      if (u) cur = u;
    } catch {
      cur = features[i];
    }
  }
  return cur;
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const businessId = (body.businessId || body.cleanerId || "").trim();
  const areaId = (body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot ?? 1);

  if (!areaId || !/^[0-9a-f-]{36}$/i.test(areaId))
    return json({ ok: false, error: "Missing or invalid areaId" }, 400);
  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);
  if (slot !== 1) return json({ ok: false, error: "Invalid slot. Only slot=1 is supported." }, 400);

  try {
    // Load target geometry
    const { data: sa, error: saErr } = await sb
      .from("service_areas")
      .select("id, gj")
      .eq("id", areaId)
      .maybeSingle();

    if (saErr || !sa?.gj) return json({ ok: false, error: "Area not found" }, 404);
    const target = toMultiPolygonFeature(sa.gj);
    if (!target) return json({ ok: false, error: "Invalid target geometry" }, 400);

    // Other subscriptions (blocking)
    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("id, business_id, area_id, status, final_geojson")
      .eq("slot", 1)
      .neq("business_id", businessId);

    if (subsErr) return json({ ok: false, error: subsErr.message || "Failed to load subscriptions" }, 500);

    // Build blockers
    const blockerFeatures = [];
    for (const s of subs || []) {
      const status = String(s.status || "").toLowerCase();
      if (!BLOCKING.has(status)) continue;

      let srcGeo = s.final_geojson;
      if (!srcGeo) {
        const { data: a } = await sb.from("service_areas").select("gj").eq("id", s.area_id).maybeSingle();
        srcGeo = a?.gj || null;
      }
      const feat = toMultiPolygonFeature(srcGeo);
      if (feat) blockerFeatures.push(feat);
    }
    const blockersUnion = blockerFeatures.length ? unionAll(blockerFeatures) : null;

    // Difference
    let purchGeom = null;
    if (!blockersUnion) {
      purchGeom = target;
    } else {
      try {
        purchGeom = turf.difference(target, blockersUnion) || null;
      } catch {
        try {
          if (!turf.booleanIntersects(target, blockersUnion)) purchGeom = target;
        } catch {}
      }
    }

    const area_km2 = purchGeom ? km2(turf.area(purchGeom)) : 0;
    if (!area_km2 || area_km2 <= 0) {
      return json({ ok: false, error: "No purchasable area available" }, 400);
    }

    // Pricing (major units)
    const currency = (process.env.RATE_CURRENCY || "GBP").toUpperCase();
    const unit_price =
      Number(process.env.RATE_PER_KM2_PER_MONTH ??
        process.env.RATE_GOLD_PER_KM2_PER_MONTH ??
        0);
    const min_monthly = Number(process.env.MIN_PRICE_PER_MONTH ??
      process.env.MIN_GOLD_PRICE_PER_MONTH ??
      0);
    const monthly_price = Math.max(min_monthly, unit_price * area_km2);

    // Ensure or create Stripe customer for this business
    // (You may already store stripe_customer_id; adapt as needed.)
    let stripeCustomerId = null;
    {
      // Example: look up from a profile table; adjust to your schema
      const { data: prof } = await sb
        .from("profiles")
        .select("stripe_customer_id")
        .eq("id", businessId)
        .maybeSingle();
      if (prof?.stripe_customer_id) {
        stripeCustomerId = prof.stripe_customer_id;
      } else {
        const c = await stripe.customers.create({ metadata: { businessId } });
        stripeCustomerId = c.id;
        await sb.from("profiles").update({ stripe_customer_id: c.id }).eq("id", businessId);
      }
    }

    // Create a one-line-item recurring subscription via Checkout
    const priceInMinor = Math.round(monthly_price * 100); // pence
    const productName = "Featured Area Sponsorship";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: productName,
              metadata: {
                area_id: areaId,
                business_id: businessId,
              },
            },
            // Monthly unit price = computed monthly for this geometry
            unit_amount: priceInMinor,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      // Metadata saved on the session so webhook can finalize
      metadata: {
        business_id: businessId,
        area_id: areaId,
        slot: "1",
        // persist the purchasable geometry the user previewed (optional; keep small)
        preview_area_km2: String(area_km2),
      },
      success_url: `${process.env.PUBLIC_SITE_URL || "https://findabincleaner.com"}/#/dashboard?checkout=success`,
      cancel_url: `${process.env.PUBLIC_SITE_URL || "https://findabincleaner.com"}/#/dashboard?checkout=cancel`,
    });

    return json({ ok: true, url: session.url });
  } catch (e) {
    return json({ ok: false, error: e?.message || "Checkout error" }, 500);
  }
};
