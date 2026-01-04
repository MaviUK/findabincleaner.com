// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

console.log("LOADED sponsored-checkout v2026-01-04-PARTIAL-OWNERSHIP");

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const EPS = 1e-6;

export default async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const businessId = String(
    body.businessId || body.business_id || body.cleanerId || body.cleaner_id || ""
  ).trim();

  const areaId = String(body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot ?? 1);

  const categoryId = String(body.categoryId || body.category_id || "").trim();
  const lockId = String(body.lockId || body.lock_id || "").trim() || null;

  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);
  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (!categoryId) return json({ ok: false, error: "Missing categoryId" }, 400);
  if (![1].includes(slot)) return json({ ok: false, error: "Invalid slot" }, 400);

  try {
    // 1) Preview remaining area (THIS is the truth for partial ownership)
    const { data: previewData, error: prevErr } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_category_id: categoryId,
      p_slot: slot,
    });

    if (prevErr) throw prevErr;

    const row = Array.isArray(previewData) ? previewData[0] : previewData;
    const availableKm2 = Number(row?.available_km2 ?? 0) || 0;

    if (availableKm2 <= EPS) {
      return json({ ok: false, code: "no_remaining", silent: true, available_km2: 0 }, 409);
    }

    // 2) Price
    const ratePerKm2 =
      Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0) || 0;

    if (!ratePerKm2 || ratePerKm2 <= 0) {
      return json(
        {
          ok: false,
          code: "missing_rate",
          message: "Pricing rate not configured.",
        },
        500
      );
    }

    const amountCents = Math.max(100, Math.round(availableKm2 * ratePerKm2 * 100));

    // 3) Stripe customer
    const { data: cleaner, error: cleanerErr } = await sb
      .from("cleaners")
      .select("id, stripe_customer_id, business_name, contact_email")
      .eq("id", businessId)
      .maybeSingle();

    if (cleanerErr) throw cleanerErr;
    if (!cleaner) return json({ ok: false, error: "Business not found" }, 404);

    let stripeCustomerId = cleaner.stripe_customer_id || null;

    if (!stripeCustomerId) {
      const created = await stripe.customers.create({
        name: cleaner.business_name || "Business",
        email: cleaner.contact_email || undefined,
        metadata: { business_id: cleaner.id },
      });

      stripeCustomerId = created.id;

      const { error: upErr } = await sb
        .from("cleaners")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", cleaner.id);

      if (upErr) throw upErr;
    }

    // 4) metadata used by webhook
    const meta = {
      business_id: cleaner.id,
      cleaner_id: cleaner.id, // back-compat
      area_id: areaId,
      slot: String(slot),
      category_id: categoryId,
      lock_id: lockId || "",
    };

    // 5) Create checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,

      metadata: meta,
      subscription_data: { metadata: meta },

      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: "Featured service area",
              description: "Be shown first in local search for the remaining part of this area.",
            },
            unit_amount: amountCents,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],

      success_url: `${process.env.PUBLIC_SITE_URL}/#dashboard?checkout=success`,
      cancel_url: `${process.env.PUBLIC_SITE_URL}/#dashboard?checkout=cancel`,
    });

    return json({ ok: true, url: session.url }, 200);
  } catch (e) {
    console.error("[sponsored-checkout] error:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
