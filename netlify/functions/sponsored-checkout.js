// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const BLOCKING = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
];

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const areaId = (body.areaId || body.area_id || "").trim();
  const businessId = (body.businessId || body.cleanerId || "").trim();
  const previewKm2 = Number(body.preview_km2);
  if (!areaId || !businessId) return json({ ok: false, error: "Missing areaId/businessId" }, 400);

  try {
    // 1) HARD BLOCK: if any blocking sub exists for this area and it is not mine, refuse checkout
    const { data: takenRows, error: takenErr } = await sb
      .from("sponsored_subscriptions")
      .select("id,business_id,status")
      .eq("area_id", areaId)
      .in("status", BLOCKING)
      .limit(1);

    if (takenErr) throw takenErr;

    if ((takenRows?.length || 0) > 0 && takenRows![0].business_id !== businessId) {
      return json(
        {
          ok: false,
          error: "This area is already sponsored (Featured).",
          code: "AREA_TAKEN",
        },
        409
      );
    }

    // 2) Compute monthly based on preview_km2 (or load area if missing)
    let km2 = Number.isFinite(previewKm2) && previewKm2 > 0 ? previewKm2 : 0;
    if (!km2) {
      // Fallback: load area size
      const { data: sa } = await sb.from("service_areas").select("gj").eq("id", areaId).maybeSingle();
      if (sa?.gj) {
        const m2 = (await import("@turf/area")).default(sa.gj);
        km2 = m2 / 1_000_000;
      }
    }

    const unit = Number(process.env.RATE_PER_KM2_PER_MONTH) || 0;
    const floor = Number(process.env.MIN_PRICE_PER_MONTH) || 0;
    const monthly = Math.max(floor, Math.round((km2 * unit + Number.EPSILON) * 100) / 100);

    // 3) Stripe checkout (standard)
    const price = await stripe.prices.create({
      unit_amount: Math.max(1, Math.round(monthly * 100)), // pence
      currency: "gbp",
      recurring: { interval: "month" },
      product_data: {
        name: "Featured Area Sponsorship",
        description: `Area ${areaId} — Featured`,
      },
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=success`,
      cancel_url: `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=cancel`,
      metadata: {
        area_id: areaId,
        business_id: businessId,
        type: "featured",
      },
    });

    return json({ ok: true, url: session.url });
  } catch (e) {
    console.error("[sponsored-checkout] error", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
