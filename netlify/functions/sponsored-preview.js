// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const RATE_GOLD = num(process.env.RATE_GOLD_PER_KM2_PER_MONTH, 1.0);
const RATE_SILV = num(process.env.RATE_SILVER_PER_KM2_PER_MONTH, 0.75);
const RATE_BRON = num(process.env.RATE_BRONZE_PER_KM2_PER_MONTH, 0.5);

const MIN_GOLD = num(process.env.MIN_GOLD_PRICE_PER_MONTH, 1.0);
const MIN_SILV = num(process.env.MIN_SILVER_PRICE_PER_MONTH, 0.75);
const MIN_BRON = num(process.env.MIN_BRONZE_PRICE_PER_MONTH, 0.5);

const CORS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization",
};

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return send({ error: "Method not allowed" }, 405);

  try {
    const { cleanerId, areaId, slot } = await req.json();
    if (!cleanerId || !areaId || !slot) {
      return send({ error: "cleanerId, areaId, slot required" }, 400);
    }

    // IMPORTANT: this RPC must clip the requested area's geometry
    // to the portion that is free for `slot`, excluding the caller’s own subscriptions.
    //
    // Expected return shape (single row):
    //   { area_km2: number, final_geojson: GeoJSON | null }
    //
    // Implemented in SQL something like:
    //   final_geojson = ST_AsGeoJSON(
    //     ST_Multi(
    //       ST_Intersection(area.geom, available_for_slot(slot, exclude_cleaner := cleanerId))
    //     )
    //   )::jsonb
    //
    const { data, error } = await sb.rpc("get_area_preview", {
      _area_id: areaId,
      _slot: Number(slot),
      _drawn_geojson: null,       // or a drawn override if you support it
      _exclude_cleaner: cleanerId // ensures caller’s own live slots don’t block themselves
    });

    if (error) {
      console.error("[sponsored-preview] RPC error:", error);
      return send({ error: "Failed to compute available geometry" }, 500);
    }

    const row = Array.isArray(data) ? data[0] : data;
    const area_km2 = Number(row?.area_km2 ?? 0);
    const final_geojson = row?.final_geojson ?? null;

    // price by slot
    const { rate, min } =
      Number(slot) === 1 ? { rate: RATE_GOLD, min: MIN_GOLD } :
      Number(slot) === 2 ? { rate: RATE_SILV, min: MIN_SILV } :
                           { rate: RATE_BRON, min: MIN_BRON };

    const monthly_price = round2(Math.max(min, Math.max(0, area_km2) * rate));

    return send({
      ok: true,
      area_km2: round5(area_km2),
      monthly_price,
      final_geojson, // 👈 UI will draw exactly this (only the purchasable piece)
    });
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    return send({ error: e?.message || "preview failed" }, 500);
  }
};

function send(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}
function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function round2(n) { return Math.round(n * 100) / 100; }
function round5(n) { return Math.round(n * 1e5) / 1e5; }
