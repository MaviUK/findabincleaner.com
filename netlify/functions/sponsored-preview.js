// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function readNum(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}
const RATE_DEFAULT = readNum("RATE_PER_KM2_PER_MONTH", 15);
const MIN_DEFAULT = readNum("MIN_PRICE_PER_MONTH", 1);

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

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const { businessId, areaId, slot } = await req.json();
    if (!businessId || !areaId || !slot) return json({ ok: false, error: "Missing params" }, 400);

    // Authoritative preview RPC (must clip away already-owned slots)
    const { data, error } = await sb.rpc("get_area_preview", {
      _area_id: areaId,
      _slot: Number(slot),
      _drawn_geojson: null,
      // if your RPC supports excluding the requester, pass the id here
      _exclude_cleaner: businessId,
    });
    if (error) {
      console.error("[sponsored-preview] get_area_preview error:", error);
      return json({ ok: false, error: "Failed to compute area" }, 200);
    }

    const row = Array.isArray(data) ? data[0] : data;
    const area_km2 = Number(row?.area_km2 ?? 0);
    const final_geojson = row?.final_geojson ?? null;

    const rate = RATE_TIER[Number(slot)] ?? RATE_DEFAULT;
    const min = MIN_TIER[Number(slot)] ?? MIN_DEFAULT;
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
