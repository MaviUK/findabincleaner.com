// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// ---------- pricing helpers ----------
function readNum(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

const RATE_DEFAULT = readNum("RATE_PER_KM2_PER_MONTH", 15);
const MIN_DEFAULT  = readNum("MIN_PRICE_PER_MONTH", 1);

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

// ---------- clipping helpers ----------
async function rpcClipBySlot(areaId, slot, cleanerId) {
  // Use your slot-specific RPCs (these should subtract owners for *that slot* only)
  const proc =
    Number(slot) === 1
      ? "clip_available_slot1_preview"
      : Number(slot) === 2
      ? "clip_available_slot2_preview"
      : "clip_available_slot3_preview";

  const { data, error } = await sb.rpc(proc, {
    p_area_id: areaId,
    p_cleaner: cleanerId, // IMPORTANT: pass through the caller (matches your checkout path)
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  const area_m2 =
    Number(row?.area_m2 ?? row?.area_sq_m ?? 0);
  const area_km2 = Math.max(0, area_m2 / 1_000_000);

  const final_geojson =
    row?.final_geojson ??
    row?.available_geojson ??
    row?.available ??
    row?.geojson ??
    row?.geometry ??
    row?.multi ??
    null;

  return { area_km2, final_geojson };
}

async function rpcGenericPreview(areaId, slot) {
  // Fallback to your existing generic RPC if slot-specific ones don’t exist
  const { data, error } = await sb.rpc("get_area_preview", {
    _area_id: areaId,
    _slot: Number(slot),
    _drawn_geojson: null,
    _exclude_cleaner: null,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  const area_km2 = Math.max(0, Number(row?.area_km2 ?? 0));
  const final_geojson =
    row?.final_geojson ??
    row?.available_geojson ??
    row?.available ??
    row?.geojson ??
    row?.geometry ??
    row?.multi ??
    null;

  return { area_km2, final_geojson };
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const { cleanerId, areaId, slot } = await req.json();
    if (!cleanerId || !areaId || ![1, 2, 3].includes(Number(slot))) {
      return json({ ok: false, error: "Missing or invalid params" }, 400);
    }

    // 1) Compute per-slot available geometry (clipped to *this* slot)
    let area_km2 = 0;
    let final_geojson = null;

    try {
      ({ area_km2, final_geojson } = await rpcClipBySlot(areaId, Number(slot), String(cleanerId)));
    } catch (e) {
      // If slot-specific RPCs aren’t deployed here, fall back gracefully
      console.warn("[sponsored-preview] slot RPC failed, using generic get_area_preview:", e?.message);
      ({ area_km2, final_geojson } = await rpcGenericPreview(areaId, Number(slot)));
    }

    // 2) Price for this slot (respecting mins)
    const rate = RATE_TIER[Number(slot)] ?? RATE_DEFAULT;
    const min  = MIN_TIER[Number(slot)]  ?? MIN_DEFAULT;
    const monthly = Math.max(min, area_km2 * rate);

    return json({
      ok: true,
      area_km2: Number(area_km2.toFixed(6)),
      monthly_price: Number(monthly.toFixed(2)),
      final_geojson,
    });
  } catch (e) {
    console.error("[sponsored-preview] fatal:", e);
    // Keep 200 with ok:false so UI can show error nicely
    return json({ ok: false, error: "Preview failed" }, 200);
  }
};
