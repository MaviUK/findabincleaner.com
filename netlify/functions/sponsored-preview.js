import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

// Per-slot pricing (fallbacks let you test locally)
const RATE = {
  1: Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? 1),   // Gold
  2: Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH ?? 0.75), // Silver
  3: Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH ?? 0.5),  // Bronze
};
const MIN = {
  1: Number(process.env.MIN_GOLD_PRICE_PER_MONTH ?? 1),
  2: Number(process.env.MIN_SILVER_PRICE_PER_MONTH ?? 0.75),
  3: Number(process.env.MIN_BRONZE_PRICE_PER_MONTH ?? 0.5),
};

const cors = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { cleanerId, areaId, slot } = await req.json();
    if (!cleanerId || !areaId || !slot) return json({ error: "cleanerId, areaId, slot required" }, 400);

    // Choose the slot-specific clipping RPC
    const proc = slot === 1
      ? "clip_available_slot1_preview"
      : slot === 2
      ? "clip_available_slot2_preview"
      : "clip_available_slot3_preview";

    // This RPC must return: [{ area_m2, final_geojson }]
    const { data, error } = await sb.rpc(proc, {
      p_cleaner: cleanerId, // helps exclude the buyer’s own polygons, if needed
      p_area_id: areaId,
    });

    if (error) {
      console.error("[sponsored-preview] rpc error:", error);
      return json({ error: "Failed to compute available area" }, 500);
    }

    const row = Array.isArray(data) ? data[0] : data;
    const area_m2 = Number(row?.area_m2 ?? 0);
    const km2 = Math.max(0, area_m2 / 1_000_000);

    const rate = RATE[slot] ?? 1;
    const min  = MIN[slot] ?? 1;
    const monthly = Math.max(min, km2 * rate);

    const tierName = slot === 1 ? "Gold" : slot === 2 ? "Silver" : "Bronze";

    return json({
      ok: true,
      slot,
      tier: tierName,
      area_km2: Number(km2.toFixed(5)),
      monthly_price: Number(monthly.toFixed(2)),
      total_price: Number(monthly.toFixed(2)), // single month here
      final_geojson: row?.final_geojson ?? null,
    });
  } catch (e) {
    console.error(e);
    return json({ error: e?.message || "Preview failed" }, 500);
  }
};
