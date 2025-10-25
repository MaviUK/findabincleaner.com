// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

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

// ---------- ownership lock ----------
const ACTIVEISH = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
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
      console.error("[sponsored-preview] owner check error:", error);
      // Fail-safe: if we can't verify, treat it as locked to avoid selling duplicates.
      return true;
    }
    if (!data?.length) return false;

    const row = data[0];
    return ACTIVEISH.has(row.status) || Boolean(row.stripe_payment_intent_id);
  } catch (e) {
    console.error("[sponsored-preview] owner check fatal:", e);
    return true; // fail-safe
  }
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));

    // Be liberal about accepted keys
    const businessId = body.businessId || body.cleanerId;
    const areaId = body.areaId || body.area_id;
    const slot = Number(body.slot);

    if (!businessId || !areaId || ![1, 2, 3].includes(slot)) {
      return json({ ok: false, error: "Missing params" }, 400);
    }

    // 1) HARD LOCK: if another business already owns this (area, slot), stop here
    if (await slotOwnedByAnotherBusiness(areaId, slot, businessId)) {
      return json({ ok: false, error: `Sponsor #${slot} is already owned for this area.` }, 200);
    }

    // 2) Otherwise, compute preview (area + clipped geometry) with your RPC
    const { data, error } = await sb.rpc("get_area_preview", {
      _area_id: areaId,
      _slot: slot,
      _drawn_geojson: null,
      // If your RPC supports it, exclude the requester to avoid counting their own coverage
      _exclude_cleaner: businessId,
    });
    if (error) {
      console.error("[sponsored-preview] get_area_preview error:", error);
      return json({ ok: false, error: "Failed to compute area" }, 200);
    }

    const row = Array.isArray(data) ? data[0] : data;
    const area_km2 = Number(row?.area_km2 ?? 0);
    const final_geojson = row?.final_geojson ?? null;

    const rate = RATE_TIER[slot] ?? RATE_DEFAULT;
    const min  = MIN_TIER[slot]  ?? MIN_DEFAULT;
    const monthly = Math.max(min, Math.max(0, area_km2) * rate);

    return json({
      ok: true,
      area_km2: Number((area_km2 || 0).toFixed(6)),
      monthly_price: Number(monthly.toFixed(2)),
      final_geojson,
    });
  } catch (e) {
    console.error("[sponsored-preview] fatal:", e);
    return json({ ok: false, error: "Preview failed" }, 200);
  }
};
