// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const cors = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization",
};

function readNum(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : fallback;
}

function tierRates(slot) {
  switch (Number(slot)) {
    case 1:
      return {
        rate: readNum("RATE_GOLD_PER_KM2_PER_MONTH", readNum("RATE_PER_KM2_PER_MONTH", 15)),
        min:  readNum("MIN_GOLD_PRICE_PER_MONTH",  readNum("MIN_PRICE_PER_MONTH", 1)),
        label: "Gold",
      };
    case 2:
      return {
        rate: readNum("RATE_SILVER_PER_KM2_PER_MONTH", readNum("RATE_PER_KM2_PER_MONTH", 12)),
        min:  readNum("MIN_SILVER_PRICE_PER_MONTH",  readNum("MIN_PRICE_PER_MONTH", 0.75)),
        label: "Silver",
      };
    case 3:
      return {
        rate: readNum("RATE_BRONZE_PER_KM2_PER_MONTH", readNum("RATE_PER_KM2_PER_MONTH", 10)),
        min:  readNum("MIN_BRONZE_PRICE_PER_MONTH",  readNum("MIN_PRICE_PER_MONTH", 0.5)),
        label: "Bronze",
      };
    default:
      return {
        rate: readNum("RATE_PER_KM2_PER_MONTH", 15),
        min:  readNum("MIN_PRICE_PER_MONTH", 1),
        label: "Unknown",
      };
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { cleanerId, areaId, slot, drawnGeoJSON, months = 1 } = await req.json();
    if (!cleanerId || !areaId || !slot) return json({ error: "cleanerId, areaId, slot required" }, 400);

    // Ask Postgres to compute the available portion for this slot
    const { data, error } = await sb.rpc("get_area_preview", {
      _area_id: areaId,
      _slot: Number(slot),
      _drawn_geojson: drawnGeoJSON ?? null,
      _exclude_cleaner: cleanerId, // exclude user’s own paid shapes from “already taken”
    });
    if (error) {
      console.error("[sponsored-preview] get_area_preview error:", error);
      return json({ error: "Failed to compute area/price" }, 500);
    }

    const area_km2 = Number((Array.isArray(data) ? data[0]?.area_km2 : data?.area_km2) ?? 0);

    const { rate, min, label } = tierRates(slot);
    const monthly = Math.max(min, Math.max(0, area_km2) * rate);
    const total = monthly * Math.max(1, Number(months));

    return json({
      ok: true,
      tier: label,
      slot: Number(slot),
      area_km2: Number(area_km2.toFixed(5)),
      monthly_price: Number(monthly.toFixed(2)),
      total_price: Number(total.toFixed(2)),
    });
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    return json({ error: e?.message || "Failed preview" }, 500);
  }
};
