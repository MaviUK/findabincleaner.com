import { createClient } from "@supabase/supabase-js";

const RATE_PER_KM2_PER_MONTH = Number(process.env.RATE_PER_KM2_PER_MONTH || 15);
const MIN_PRICE_PER_MONTH   = Number(process.env.MIN_PRICE_PER_MONTH || 5);

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const cors = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization",
};

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { cleanerId, drawnGeoJSON, months = 1 } = await req.json();
    if (!cleanerId || !drawnGeoJSON) return json({ error: "cleanerId and drawnGeoJSON required" }, 400);

    // Clip preview (no writes)
    const { data, error } = await sb.rpc("clip_available_slot1_preview", {
      p_cleaner: cleanerId,
      p_geojson: drawnGeoJSON,
    });
    if (error) throw error;

    if (!data || data.length === 0) {
      return json({ ok: true, area_km2: 0, monthly_price: 0, total_price: 0, final_geojson: null });
    }

    const { area_m2, final_geojson } = data[0];
    const km2 = area_m2 / 1_000_000;
    const monthly = Math.max(km2 * RATE_PER_KM2_PER_MONTH, MIN_PRICE_PER_MONTH);
    const total = monthly * Math.max(1, Number(months));

    return json({
      ok: true,
      area_km2: Number(km2.toFixed(5)),
      monthly_price: Number(monthly.toFixed(2)),
      total_price: Number(total.toFixed(2)),
      final_geojson,
    });
  } catch (e) {
    console.error(e);
    return json({ error: e.message || "Failed preview" }, 500);
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
