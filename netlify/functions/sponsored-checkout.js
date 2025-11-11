// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const businessId = String(body.businessId || "").trim();
  const areaId = String(body.areaId || "").trim();
  const slot = Number(body.slot ?? 1);

  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);
  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (!Number.isFinite(slot) || slot < 1) return json({ ok: false, error: "Invalid slot" }, 400);

  try {
    // 1) Check if another business blocks this slot
    const { data: taken, error: takenErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id,status")
      .eq("area_id", areaId)
      .eq("slot", slot)
      .order("created_at", { ascending: false })
      .limit(1);

    if (takenErr) throw takenErr;

    if (Array.isArray(taken) && taken.length > 0) {
      const row = taken[0];
      const status = String(row.status || "").toLowerCase();
      if (BLOCKING.has(status) && row.business_id !== businessId) {
        return json({ ok: false, error: "This slot is already taken.", conflict: true }, 409);
      }
    }

    // 2) Recompute available km2 via RPC; reject if 0
    const { data, error } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    const area_km2 = Number(row?.area_km2 ?? 0) || 0;
    if (area_km2 <= 0) {
      return json({ ok: false, error: "No purchasable area left for this slot." }, 200);
    }

    // 3) Pricing
    const rateMap = {
      1: Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 1),
      2: Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 1),
      3: Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 1),
    };
    const rate_per_km2 = Number.isFinite(rateMap[slot]) ? rateMap[slot] : 1;

    const floorMap = {
      1: Number(process.env.MIN_GOLD_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 1),
      2: Number(process.env.MIN_SILVER_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 1),
      3: Number(process.env.MIN_BRONZE_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 1),
    };
    const floor_monthly = Number.isFinite(floorMap[slot]) ? floorMap[slot] : 1;

    const monthly = Math.max(area_km2 * rate_per_km2, floor_monthly);
    const amount_cents = Math.max(1, Math.round(monthly * 100));
    const siteUrl = process.env.PUBLIC_SITE_URL || "http://localhost:5173";

    // 4) Create a simple recurring price on the fly (or use an existing Price ID if you prefer)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      success_url: `${siteUrl}/#dashboard?checkout=success`,
      cancel_url: `${siteUrl}/#dashboard?checkout=cancel`,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            recurring: { interval: "month" },
            product_data: {
              name: `Featured Sponsorship — Area ${areaId} (slot ${slot})`,
              metadata: { area_id: areaId, slot: String(slot), business_id: businessId },
            },
            unit_amount: amount_cents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        area_id: areaId,
        slot: String(slot),
        business_id: businessId,
      },
    });

    return json({ ok: true, url: session.url }, 200);
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
