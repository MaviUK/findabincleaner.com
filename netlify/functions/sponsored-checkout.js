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

// ---------- ownership lock / states we treat as "taken" ----------
const LIVE_OR_PENDING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
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
      // Fail-safe: if we can't verify, treat it as locked to avoid over-selling.
      return true;
    }
    if (!data?.length) return false;

    const row = data[0];
    // Any live/pending-ish state OR a captured/created PI counts as owned.
    return LIVE_OR_PENDING.has(row.status) || Boolean(row.stripe_payment_intent_id);
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

    // 1) HARD LOCK: block if another business already owns this (area,slot)
    if (await slotOwnedByAnotherBusiness(areaId, slot, businessId)) {
      return json({ error: `Sponsor #${slot} is already owned by another business for this area.` }, 409);
    }

    // 2) Compute the available (clipped) area now to ensure there’s something to sell
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

    // 4) Insert a provisional subscription row (status=incomplete)
    const { data: inserted, error: insErr } = await sb
      .from("sponsored_subscriptions")
      .insert({
        business_id: businessId,
        area_id: areaId,
        slot,
        status: "incomplete",
      })
      .select("id")
      .limit(1)
      .single();

    if (insErr) {
      // Decode common unique-constraint collisions so the UI shows the *real* reason
      const code = insErr?.code || insErr?.details?.code;
      const constraint = insErr?.constraint || insErr?.details?.constraint;

      if (code === "23505") {
        // Area-level lock (any slot in this area)
        if (constraint === "ux_live_or_pending_area" || constraint === "ux_active_area_slot") {
          return json({ error: "This area is already owned. No slots are available." }, 409);
        }
        // Exact slot in this area
        if (constraint === "uniq_live_slot" || constraint === "uniq_live_or_pending_slot") {
          return json({ error: `Sponsor #${slot} is already taken for this area.` }, 409);
        }
        // Platform-wide “same slot per business” rule (keep only if you intend it)
        if (constraint === "uniq_active_slot_per_business") {
          return json({
            error: `Your business already has an active/pending subscription for Sponsor #${slot} in another area.`,
          }, 409);
        }
      }

      console.error("[sponsored-checkout] insert provisional sub failed:", insErr);
      return json({ error: "Could not create a provisional subscription." }, 409);
    }

    const subId = inserted?.id;

    // 5) Create Stripe Checkout Session (subscription)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
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
      // If you persist/reuse Stripe customers, you can pass customer / customer_email here.
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
