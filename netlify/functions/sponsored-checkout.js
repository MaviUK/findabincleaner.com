// netlify/functions/sponsored-checkout.js

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Helper to send JSON responses
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Statuses that “block” a slot for other businesses
const BLOCKING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);

// Small epsilon for float comparisons
const EPS = 1e-6;

export default async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const businessId = String(body.businessId || body.cleanerId || "").trim();
  const areaId = String(body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot || 1);

  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);
  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (![1].includes(slot))
    return json({ ok: false, error: "Invalid slot" }, 400);

  try {
    //
    // 1) Hard block: is this featured slot already owned by someone else?
    //
    const { data: takenRows, error: takenErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id, status")
      .eq("area_id", areaId)
      .eq("slot", slot);

    if (takenErr) throw takenErr;

    const blocking = (takenRows || []).filter((r) =>
      BLOCKING.has(String(r.status || "").toLowerCase())
    );

    const ownedByOther =
      (blocking?.length || 0) > 0 &&
      String(blocking[0].business_id) !== String(businessId);

    if (ownedByOther) {
      return json(
        {
          ok: false,
          code: "slot_taken",
          message: "No purchasable area left for this slot.",
        },
        409
      );
    }

    //
    // 2) Ask the DB how much area is actually available for this
    //    (taking into account other sponsors' polygons).
    //
    const { data: previewRow, error: prevErr } = await sb.rpc(
      "area_remaining_preview",
      {
        p_area_id: areaId,
        p_slot: slot,
      }
    );
    if (prevErr) throw prevErr;

    const row = Array.isArray(previewRow)
      ? previewRow[0] || {}
      : previewRow || {};

    const total_km2 = Number(row.total_km2 ?? 0) || 0;
    const available_km2 =
      Number(row.available_km2 ?? row.area_km2 ?? 0) || 0; // support old schema names

    if (available_km2 <= EPS) {
      return json(
        {
          ok: false,
          code: "no_remaining",
          message: "No purchasable area left for this slot.",
        },
        409
      );
    }

    //
    // 3) Work out the price
    //
    const rate_per_km2 =
      Number(
        process.env.RATE_GOLD_PER_KM2_PER_MONTH ??
          process.env.RATE_PER_KM2_PER_MONTH ??
          0
      ) || 0;

    const amount_cents = Math.max(
      1,
      Math.round(available_km2 * rate_per_km2 * 100)
    );

    //
    // 4) Look up (or create) the Stripe customer based on the cleaner
    //
    const { data: cleaner, error: cleanerErr } = await sb
      .from("cleaners")
      .select("stripe_customer_id, email")
      .eq("id", businessId)
      .maybeSingle();

    if (cleanerErr) throw cleanerErr;

    let stripeCustomerId = cleaner?.stripe_customer_id || null;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: cleaner?.email || undefined,
      });

      stripeCustomerId = customer.id;

      await sb
        .from("cleaners")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", businessId);
    }

    //
    // 5) (NEW) Save / update a pending sponsored_subscriptions row with area + price
    //
    const { data: existingSub, error: existingErr } = await sb
      .from("sponsored_subscriptions")
      .select("id")
      .eq("business_id", businessId)
      .eq("area_id", areaId)
      .eq("slot", slot)
      .maybeSingle();

    if (existingErr) throw existingErr;

    if (existingSub) {
      const { error: upErr } = await sb
        .from("sponsored_subscriptions")
        .update({
          area_km2: available_km2,
          price_cents: amount_cents,
          stripe_customer_id: stripeCustomerId,
          status: "pending", // will be set to "active" by webhook
        })
        .eq("id", existingSub.id);

      if (upErr) throw upErr;
    } else {
      const { error: insErr } = await sb
        .from("sponsored_subscriptions")
        .insert({
          business_id: businessId,
          area_id: areaId,
          slot,
          area_km2: available_km2,
          price_cents: amount_cents,
          stripe_customer_id: stripeCustomerId,
          status: "pending",
        });

      if (insErr) throw insErr;
    }

    //
    // 6) Create the Stripe Checkout Session (subscription)
    //
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      metadata: {
        business_id: businessId,
        area_id: areaId,
        slot: String(slot),
      },
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: "Featured service area",
              description: "Be shown first in local search for this area.",
            },
            unit_amount: amount_cents,
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
    console.error("sponsored-checkout error:", e);
    return json(
      { ok: false, error: e?.message || "Server error in sponsored-checkout" },
      500
    );
  }
};
