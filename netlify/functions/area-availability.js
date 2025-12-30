// netlify/functions/area-availability.js
import { createClient } from "@supabase/supabase-js";

console.log("LOADED area-availability v2025-12-30-CORS-GUARDS");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "content-type",
};

// Normalize row shapes into what the UI expects
function pickGeom(row) {
  if (!row || typeof row !== "object") return { existing: null, available: null, ok: false };

  const existing = row.existing ?? row.existing_gj ?? row.existing_geojson ?? null;
  const available = row.available ?? row.available_gj ?? row.available_geojson ?? null;

  const ok = typeof row.ok === "boolean" ? row.ok : Boolean(available);
  return { existing, available, ok };
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    const area_id = url.searchParams.get("area_id");
    const slot = parseInt(url.searchParams.get("slot") || "1", 10);

    // IMPORTANT: your UI sometimes passes cleaner_id to exclude “your own” sponsorship
    const cleaner_id = url.searchParams.get("cleaner_id") || null;

    if (!area_id || !Number.isFinite(slot)) {
      return new Response(JSON.stringify({ error: "area_id and slot are required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // 1) Try AVAILABILITY first
    const { data: avData, error: avErr } = await supabase.rpc("get_area_availability", {
      _area_id: area_id,
      _slot: slot,
      _exclude_cleaner: cleaner_id,
    });

    if (avErr) throw avErr;

    const avRow = Array.isArray(avData) ? avData[0] || {} : avData || {};
    let { existing, available, ok } = pickGeom(avRow);

    // 2) Fallback to PREVIEW when availability provides no geometries
    const noGeom = !existing && !available;
    if (!ok || noGeom) {
      const { data: prevData, error: prevErr } = await supabase.rpc("get_area_preview", {
        _area_id: area_id,
        _slot: slot,
        _drawn_geojson: null, // use saved service area
        _exclude_cleaner: cleaner_id,
      });

      if (!prevErr && prevData) {
        const prevRow = Array.isArray(prevData) ? prevData[0] || {} : prevData || {};
        const area_km2 = Number(prevRow.area_km2 ?? 0);
        const final_geojson = prevRow.final_geojson ?? prevRow.final_gj ?? prevRow.final ?? null;

        if (final_geojson && area_km2 > 0) {
          available = final_geojson;
          ok = true;
        }
      }
    }

    return new Response(JSON.stringify({ ok, existing, available }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "failed" }), {
      status: 500,
      headers: corsHeaders,
    });
  }
};
