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

// ---------- pricing env helpers ----------
function readNum(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}
const RATE_DEFAULT = readNum("RATE_PER_KM2_PER_MONTH", 15);
const MIN_DEFAULT  = readNum("MIN_PRICE_PER_MONTH", 1);

const RATE_TIER = {
  1: readNum("RATE_GOLD_PER_KM2_PER_MONTH", RATE_DEFAULT),
  2: readNum("RATE_SILVER_PER_KM2_PER_MONTH", RATE_DEFAULT),
  3: readNum("RATE_BRONZE_PER_KM2_PER_MONTH", RATE_DEFAULT),
};
const MIN_TIER = {
  1: readNum("MIN_GOLD_PRICE_PER_MONTH", MIN_DEFAULT),
  2: readNum("MIN_SILVER_PRICE_PER_MONTH", MIN_DEFAULT),
  3: readNum("MIN_BRONZE_PRICE_PER_MONTH", MIN_DEFAULT),
};

// ---------- activity / locks ----------
const ACTIVEISH = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
  "provisional",
  "pending",
]);

async function slotOwnedByAnotherBusiness(areaId, slot, businessId) {
  try {
    const { data, error } = await sb
      .from("sponsored_subscriptions")
      .select("id,business_id,status,stripe_payment_intent_id")
      .eq("area_id", areaId)
      .eq("slot", Number(slot))
      .neq("business_id", businessId)
      .limit(1);

    if (error) {
      console.error("[sponsored-checkout] owner check error:", error);
      // Fail-safe: unknown state -> block oversell.
      return true;
    }
    if (!data?.length) return false;

    const row = data[0];
    return ACTIVEISH.has(row.status) || Boolean(row.stripe_payment_intent_id);
  } catch (e) {
    console.error("[sponsored-checkout] owner check fatal:", e);
    return true; // fail-safe
  }
}

async function computeAvailableKm2(areaId, slot, excludeBusinessId) {
  const { data, error } = await sb.rpc("get_area_preview", {
    _area_id: areaId,
    _slot: Number(slot),
    _drawn_geojson: null,
    _exclude_cleaner: excludeBusinessId || null,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  const km2 = Number(row?.area_km2 ?? 0);
  return {
    km2: Number.isFinite(km2) ? km2 : 0,
    final_geojson: row?.final_geojson ?? null,
  };
}

async function fetchStripeCustomerId(businessId) {
  // Adjust this to your schema. Common locations:
  // - public.cleaners (stripe_customer_id)
  // - public.profiles  (stripe_customer_id)
  // We try cleaners first, then profiles.
  const tryTables = ["cleaners", "profiles"];

  for (const table of tryTables) {
    const { data, error } = await sb
      .from(table)
      .select("stripe_customer_id")
      .eq("id", businessId)
      .limit(1)
      .single();

    if (!error && data?.stripe_customer_id) {
      return data.stripe_customer_id;
    }
  }
  return null;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));

    // Accept liberal keys from the client
    const businessId = body.businessId || body.cleanerId;
    const areaId = body.areaId || body.area_id;
    const slot = Number(body.slot);
    const returnUrl =
      body.return_url || process.env.PUBLIC_SITE_URL || "https://findabincleaner.netlify.app";

    if (!businessId || !areaId || ![1, 2, 3].includes(slot)) {
      return json({ error: "Missing params" }, 400);
    }

    // 0) Stripe customer id (avoid NOT NULL violation)
    const stripeCustomerId = await fetchStripeCustomerId(businessId);
    if (!stripeCustomerId) {
      return json({ error: "No Stripe customer id for this business." }, 409);
    }

    // 1) HARD LOCK: another business already holds this (area,slot)?
    if (await slotOwnedByAnotherBusiness(areaId, slot, businessId)) {
      return json(
        { error: `Sponsor #${slot} is already owned by another business for this area.` },
        409
      );
    }

    // 2) Compute current available area (clipped)
    let availableKm2 = 0;
    try {
      const { km2 } = await computeAvailableKm2(areaId, slot, businessId);
      availableKm2 = km2;
    } catch (e) {
      console.error("[sponsored-checkout] preview RPC failed:", e);
      return json({ error: "Failed to compute available area" }, 500);
    }
    if (!Number.isFinite(availableKm2) || availableKm2 <= 0) {
      return json({ error: "No purchasable area left for this slot." }, 409);
    }

    // 3) Price calc
    const rate = RATE_TIER[slot] ?? RATE_DEFAULT;
    const min  = MIN_TIER[slot]  ?? MIN_DEFAULT;
    const monthly = Math.max(min, Math.max(0, availableKm2) * rate);
    const unitAmountPence = Math.round(monthly * 100);

    // 4) Insert a provisional subscription row (status=incomplete) with Stripe + price fields
    const { data: inserted, error: insErr } = await sb
      .from("sponsored_subscriptions")
      .insert({
        business_id: businessId,
        area_id: areaId,
        slot,
        status: "incomplete",
        stripe_customer_id: stripeCustomerId,
        currency: "gbp",
        price_monthly_pennies: unitAmountPence, // include price explicitly
      })
      .select("id")
      .limit(1)
      .single();

    if (insErr) {
      console.error("[sponsored-checkout] insert provisional sub failed:", insErr);
      return json({ error: "Could not create a provisional subscription." }, 409);
    }

    const subId = inserted?.id;

    // 5) Create Stripe Checkout Session (subscription)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId, // use the customer you fetched
      success_url: `${returnUrl}/#/dashboard?ok=1`,
      cancel_url: `${returnUrl}/#/dashboard?canceled=1`,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            unit_amount: unitAmountPence,
            product_data: {
              name: `Area sponsorship #${slot} (${slot === 1 ? "Gold" : slot === 2 ? "Silver" : "Bronze"})`,
              description: `Available area at checkout time: ${availableKm2.toFixed(4)} km²`,
            },
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      metadata: {
        fb_area_id: areaId,
        fb_slot: String(slot),
        fb_business_id: businessId,
        fb_sub_id: subId || "",
      },
    });

    // 6) Save the session id on the provisional row
    await sb
      .from("sponsored_subscriptions")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", subId);

    return json({ url: session.url });
  } catch (e) {
    console.error("[sponsored-checkout] fatal:", e);
    return json({ error: "Checkout failed" }, 500);
  }
};
