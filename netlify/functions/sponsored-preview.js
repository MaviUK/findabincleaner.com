// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

// ---------- pricing helpers (per slot 1/2/3) ----------
function readNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : fallback;
}
function readFirstEnvNumber(names, fallback) {
  for (const n of names) {
    const v = readNumberEnv(n, Number.NaN);
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}
function getSlotConfig(slot) {
  // Support both “slot” and “gold/silver/bronze” env names (whichever you set)
  if (slot === 1) {
    return {
      rate: readFirstEnvNumber(
        ["RATE_SLOT1_PER_KM2_PER_MONTH", "RATE_GOLD_PER_KM2_PER_MONTH", "RATE_PER_KM2_PER_MONTH"],
        15
      ),
      min: readFirstEnvNumber(
        ["MIN_SLOT1_PRICE_PER_MONTH", "MIN_GOLD_PRICE_PER_MONTH", "MIN_PRICE_PER_MONTH"],
        5
      ),
      label: "Gold",
    };
  }
  if (slot === 2) {
    return {
      rate: readFirstEnvNumber(
        ["RATE_SLOT2_PER_KM2_PER_MONTH", "RATE_SILVER_PER_KM2_PER_MONTH", "RATE_PER_KM2_PER_MONTH"],
        10
      ),
      min: readFirstEnvNumber(
        ["MIN_SLOT2_PRICE_PER_MONTH", "MIN_SILVER_PRICE_PER_MONTH", "MIN_PRICE_PER_MONTH"],
        4
      ),
      label: "Silver",
    };
  }
  return {
    rate: readFirstEnvNumber(
      ["RATE_SLOT3_PER_KM2_PER_MONTH", "RATE_BRONZE_PER_KM2_PER_MONTH", "RATE_PER_KM2_PER_MONTH"],
      7
    ),
    min: readFirstEnvNumber(
      ["MIN_SLOT3_PRICE_PER_MONTH", "MIN_BRONZE_PRICE_PER_MONTH", "MIN_PRICE_PER_MONTH"],
      3
    ),
    label: "Bronze",
  };
}
function computeMonthly(areaKm2, slot) {
  const { rate, min } = getSlotConfig(slot);
  const raw = Math.max(0, Number(areaKm2)) * rate;
  return Math.max(min, raw);
}

// ---------- supabase / utils ----------
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const cors = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { cleanerId, areaId, drawnGeoJSON, months = 1, slot = 1 } = await req.json();

    // Validate
    const slotNum = Number(slot);
    if (![1, 2, 3].includes(slotNum)) return json({ error: "Invalid slot (1|2|3)" }, 400);
    if (!cleanerId) return json({ error: "cleanerId required" }, 400);
    if (!areaId && !drawnGeoJSON) {
      return json({ error: "Provide either areaId or drawnGeoJSON" }, 400);
    }

    // Use a single preview RPC for both cases. It:
    // - Intersects drawn geometry with available portion for the slot
    // - Or uses the saved area when _area_id is provided
    const { data, error } = await sb.rpc("get_area_preview", {
      _area_id: areaId ?? null,
      _slot: slotNum,
      _drawn_geojson: drawnGeoJSON ?? null,
      _exclude_cleaner: cleanerId, // exclude user's own current holds/purchases
    });
    if (error) throw error;

    const record = Array.isArray(data) ? data[0] : data;
    const area_km2 = Number(record?.area_km2 ?? 0);
    const final_geojson = record?.final_geojson ?? null;

    const monthly = computeMonthly(area_km2, slotNum);
    const total = monthly * Math.max(1, Number(months));

    return json({
      ok: true,
      slot: slotNum,
      tier: getSlotConfig(slotNum).label,
      area_km2: Number(area_km2.toFixed(5)),
      monthly_price: Number(monthly.toFixed(2)),
      total_price: Number(total.toFixed(2)),
      final_geojson,
    });
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    return json({ error: e?.message || "Failed preview" }, 500);
  }
};
