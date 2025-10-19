import { createClient } from "@supabase/supabase-js";

// CORS + JSON helpers
const cors = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

// Per-slot pricing from env (falls back to global RATE/MIN if specific slot not set)
function numberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : fallback;
}
function slotPricing(slot) {
  // Global fallbacks
  const RATE = numberEnv("RATE_PER_KM2_PER_MONTH", 15);
  const MIN  = numberEnv("MIN_PRICE_PER_MONTH", 1);

  // Slot-specific (optional)
  if (slot === 1) {
    return {
      rate: numberEnv("RATE_GOLD_PER_KM2_PER_MONTH", RATE),
      min:  numberEnv("MIN_GOLD_PRICE_PER_MONTH",   MIN),
    };
  }
  if (slot === 2) {
    return {
      rate: numberEnv("RATE_SILVER_PER_KM2_PER_MONTH", RATE),
      min:  numberEnv("MIN_SILVER_PRICE_PER_MONTH",   MIN),
    };
  }
  return {
    rate: numberEnv("RATE_BRONZE_PER_KM2_PER_MONTH", RATE),
    min:  numberEnv("MIN_BRONZE_PRICE_PER_MONTH",   MIN),
  };
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let cleanerId, areaId, slot;
  try {
    const body = await req.json();
    cleanerId = body?.cleanerId;
    areaId = body?.areaId;
    slot = Number(body?.slot);
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  if (!cleanerId || !areaId || !slot) {
    return json({ ok: false, error: "Missing params" }, 400);
  }

  try {
    // Ask the DB to return the billable portion for this slot (excluding already purchased overlaps)
    const { data, error } = await sb.rpc("get_area_preview", {
      _area_id: areaId,
      _slot: slot,
      _drawn_geojson: null,     // we use the saved area geometry
      _exclude_cleaner: null,   // or cleanerId if you want to exclude the caller’s own subs
    });

    if (error) {
      console.error("[sponsored-preview] get_area_preview error:", error);
      return json({ ok: false, error: "DB error" }, 500);
    }

    const row = Array.isArray(data) ? data[0] : data;
    const area_km2 = Number(row?.area_km2 ?? 0);
    const { rate, min } = slotPricing(slot);
    const monthly_price = Number(Math.max(min, Math.max(0, area_km2) * rate).toFixed(2));

    return json({
      ok: true,
      area_km2: Number(area_km2.toFixed(5)),
      monthly_price,
      final_geojson: row?.final_geojson ?? null, // can be null if your SQL doesn’t return it
    });
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
