// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const cors = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization",
};

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function rateForSlot(slot) {
  // Optional per-slot rates
  const rates = {
    1: process.env.RATE_SLOT1,
    2: process.env.RATE_SLOT2,
    3: process.env.RATE_SLOT3,
  };
  const mins = {
    1: process.env.MIN_PRICE_SLOT1,
    2: process.env.MIN_PRICE_SLOT2,
    3: process.env.MIN_PRICE_SLOT3,
  };

  const fallbackRate = num(process.env.RATE_PER_KM2_PER_MONTH, 15);
  const fallbackMin = num(process.env.MIN_PRICE_PER_MONTH, 1);

  return {
    rate: num(rates[slot], fallbackRate),
    min: num(mins[slot], fallbackMin),
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const { cleanerId, areaId, slot, drawnGeoJSON = null, months = 1 } = await req.json();

    if (!cleanerId || !areaId || !slot) {
      return json({ ok: false, error: "cleanerId, areaId, slot required" }, 400);
    }

    // Ask DB how much of this area is actually available for the slot,
    // taking into account overlaps & existing sponsorships.
    const { data, error } = await sb.rpc("get_area_preview", {
      _area_id: areaId,
      _slot: Number(slot),
      _drawn_geojson: drawnGeoJSON,     // keep null to use saved polygons
      _exclude_cleaner: cleanerId,      // exclude the caller's own subs if helpful
    });

    if (error) {
      console.error("[sponsored-preview] get_area_preview error:", error);
      return json({ ok: false, error: "Failed to compute area/price" }, 500);
    }

    const row = Array.isArray(data) ? data[0] : data;
    const area_km2 = num(row?.area_km2, 0);

    const { rate, min } = rateForSlot(Number(slot));
    const monthly = Math.max(min, Math.max(0, area_km2) * rate);
    const total = monthly * Math.max(1, num(months, 1));

    return json({
      ok: true,
      area_km2: Number(area_km2.toFixed(5)),
      monthly_price: Number(monthly.toFixed(2)),
      total_price: Number(total.toFixed(2)),
      final_geojson: row?.final_geojson ?? null,
    });
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    return json({ ok: false, error: e.message || "Failed preview" }, 500);
  }
};
