// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

// Per-slot pricing from env, with sane fallbacks for local runs.
const RATE = {
  1: Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? 1),
  2: Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH ?? 0.75),
  3: Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH ?? 0.5),
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
    if (!cleanerId || !areaId || !slot) {
      return json({ error: "cleanerId, areaId, slot required" }, 400);
    }

    // Use the existing slot-aware preview RPC that already powers checkout.
    // It returns the AVAILABLE area for the given slot (i.e. excludes taken pieces).
    const { data, error } = await sb.rpc("get_area_preview", {
      _area_id: areaId,
      _slot: Number(slot),
      _drawn_geojson: null,        // using saved geometry
      _exclude_cleaner: cleanerId, // helps avoid counting the caller’s own coverage
    });

    if (error) {
      console.error("[sponsored-preview] get_area_preview error:", error);
      return json({ error: "Failed to compute available area" }, 500);
    }

    const row = Array.isArray(data) ? data[0] : data;
    const km2 = Number(row?.area_km2 ?? 0);
    const rate = RATE[slot] ?? 1;
    const min  = MIN[slot] ?? 1;

    const monthly = Math.max(min, Math.max(0, km2) * rate);
    const tier = slot === 1 ? "Gold" : slot === 2 ? "Silver" : "Bronze";

    return json({
      ok: true,
      slot,
      tier,
      area_km2: Number((km2 || 0).toFixed(5)),
      monthly_price: Number(monthly.toFixed(2)),
      total_price: Number(monthly.toFixed(2)), // one month shown
      final_geojson: row?.final_geojson ?? null,
    });
  } catch (e) {
    console.error(e);
    return json({ error: e?.message || "Preview failed" }, 500);
  }
};
