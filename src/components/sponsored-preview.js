import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

// CORS + JSON helper
const CORS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

// Slot-aware envs with safe fallbacks
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const RATE_GOLD   = num(process.env.RATE_GOLD_PER_KM2_PER_MONTH,   num(process.env.RATE_PER_KM2_PER_MONTH, 15));
const RATE_SILVER = num(process.env.RATE_SILVER_PER_KM2_PER_MONTH, RATE_GOLD);
const RATE_BRONZE = num(process.env.RATE_BRONZE_PER_KM2_PER_MONTH, RATE_GOLD);

const MIN_GOLD   = num(process.env.MIN_GOLD_PRICE_PER_MONTH,   num(process.env.MIN_PRICE_PER_MONTH, 1));
const MIN_SILVER = num(process.env.MIN_SILVER_PRICE_PER_MONTH, MIN_GOLD);
const MIN_BRONZE = num(process.env.MIN_BRONZE_PRICE_PER_MONTH, MIN_GOLD);

function rateFor(slot) {
  return slot === 1 ? RATE_GOLD : slot === 2 ? RATE_SILVER : RATE_BRONZE;
}
function minFor(slot) {
  return slot === 1 ? MIN_GOLD : slot === 2 ? MIN_SILVER : MIN_BRONZE;
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { cleanerId, areaId, slot } = await req.json();

    // Basic validation
    const slotNum = Number(slot);
    if (!cleanerId || !areaId || ![1, 2, 3].includes(slotNum)) {
      return json({ error: "cleanerId, areaId, and slot (1|2|3) are required" }, 400);
    }

    // Call your RPC that clips out already-purchased areas and gives the remaining piece
    // Change the RPC name/params here if your SQL uses different names.
    const { data, error } = await sb.rpc("get_area_preview", {
      _area_id: areaId,
      _slot: slotNum,
      _drawn_geojson: null,      // we are using the saved area geometry
      _exclude_cleaner: null,    // don’t exclude buyer; function should clip by existing subs
    });

    if (error) {
      console.error("[sponsored-preview] RPC error:", error);
      return json({ error: "Failed to compute available area" }, 500);
    }

    // Some deployments return an array row
    const row = Array.isArray(data) ? data[0] : data;
    const area_km2 = num(row?.area_km2, 0);
    const final_geojson = row?.final_geojson ?? null;

    // Price: max(minimum, area * rate)
    const monthly_price = Math.max(minFor(slotNum), Math.max(0, area_km2) * rateFor(slotNum));

    return json({
      ok: true,
      slot: slotNum,
      area_km2: Number(area_km2.toFixed(6)),
      monthly_price: Number(monthly_price.toFixed(2)),
      final_geojson,
    });
  } catch (e) {
    console.error("[sponsored-preview] handler error:", e);
    return json({ error: e?.message || "Internal error" }, 500);
  }
};
