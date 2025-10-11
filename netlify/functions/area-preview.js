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

// Price helpers
function toPounds(n) {
  // keep as number; formatting happens in the UI
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
    try {
      body = await req.json();
    } catch {
      // keep empty
    }

    const areaId = body.areaId || body.area_id || null;
    const slot = Number(body.slot ?? body.months ?? 1) || 1;

    // drawnGeoJSON may be object or string; normalize to object (or null)
    let drawnGeoJSON = body.drawnGeoJSON ?? body.drawn_geojson ?? null;
    if (typeof drawnGeoJSON === 'string') {
      try { drawnGeoJSON = JSON.parse(drawnGeoJSON); } catch { drawnGeoJSON = null; }
    }
    const excludeCleaner = body.cleanerId ?? body.excludeCleaner ?? null;

    if (!areaId || !slot) {
      return new Response(JSON.stringify({ error: 'area_id and slot are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Call SQL preview (4-arg)
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

    // ⚠️ Supabase returns an array for RETURNS TABLE. Normalize to a single row.
    const row = Array.isArray(data) ? (data[0] || {}) : (data || {});

    // Prefer SQL’s values if present; otherwise compute pricing here
    const months = Number(row.months ?? slot) || 1;
    const area_km2 = Number(row.area_km2 ?? 0);

    // Pricing inputs (env). If missing, we’ll pass through SQL prices if present.
    const RATE = readNumberEnv('RATE_PER_KM2_PER_MONTH', null);
    const MIN  = readNumberEnv('MIN_PRICE_PER_MONTH', null);

    let monthly_price = null;
    let total_price = null;

    if (Number.isFinite(row.monthly_price)) {
      monthly_price = Number(row.monthly_price);
      total_price   = Number(row.total_price ?? months * monthly_price);
    } else if (Number.isFinite(area_km2) && area_km2 > 0 && Number.isFinite(RATE) && Number.isFinite(MIN)) {
      const rawMonthly = Math.max(MIN, area_km2 * RATE);
      monthly_price = toPounds(rawMonthly);
      total_price   = toPounds(rawMonthly * months);
    }

    const ok = !!row.ok && area_km2 > 0;

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
