// netlify/functions/area-preview.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// Helper to coerce a number env safely
function readNumberEnv(name, fallback = null) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : fallback;
}

function toPounds(n) {
  return Math.round(n * 100) / 100;
}

export default async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Use POST with JSON body' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    }

    let body = {};
    try { body = await req.json(); } catch {}

    const areaId         = body.areaId || body.area_id;
    const slot           = Number(body.slot ?? body.months ?? 1) || 1;
    const drawnGeoJSON   = body.drawnGeoJSON ?? body.drawn_geojson ?? null;
    const excludeCleaner = body.cleanerId ?? body.excludeCleaner ?? null;

    if (!areaId || !slot) {
      return new Response(JSON.stringify({ error: 'area_id and slot are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Call SQL preview
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: areaId,
      _slot: slot,
      _drawn_geojson: drawnGeoJSON,
      _exclude_cleaner: excludeCleaner,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    // 🔧 NEW: normalize the RPC result (TABLE return => array of rows)
    const row = Array.isArray(data) ? (data[0] || {}) : (data || {});

    const area_km2 = Number(row.area_km2 ?? 0);
    const months   = Number(slot) || 1;

    const RATE = readNumberEnv('RATE_PER_KM2_PER_MONTH', null);
    const MIN  = readNumberEnv('MIN_PRICE_PER_MONTH', null);

    const hasGeom =
      row.final_geojson &&
      typeof row.final_geojson === 'object' &&
      Array.isArray(row.final_geojson.coordinates) &&
      row.final_geojson.coordinates.length > 0;

    const ok = (Number.isFinite(area_km2) && area_km2 > 0) || hasGeom;

    let monthly_price = null;
    let total_price   = null;
    if (ok && Number.isFinite(RATE) && Number.isFinite(MIN)) {
      const rawMonthly = Math.max(MIN, area_km2 * RATE);
      monthly_price = toPounds(rawMonthly);
      total_price   = toPounds(rawMonthly * months);
    }

    return new Response(
      JSON.stringify({
        ok,
        final_geojson: row.final_geojson ?? null,
        area_km2: Number.isFinite(area_km2) ? area_km2 : 0,
        months,
        monthly_price,
        total_price,
      }),
      {
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        },
      }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || 'failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
