// netlify/functions/area-preview.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

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

    const area_id = body.areaId || body.area_id;
    const slot = Number(body.slot ?? body.months ?? 1);
    const drawnGeoJSON = body.drawnGeoJSON ?? body.drawn_geojson ?? null;
    const excludeCleaner = body.excludeCleaner ?? body._exclude_cleaner ?? null;

    if (!area_id || !slot) {
      return new Response(JSON.stringify({ error: 'area_id and slot are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // IMPORTANT: pass ALL 4 named args, even when exclude is null
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: area_id,
      _slot: slot,
      _drawn_geojson: drawnGeoJSON,  // note the leading underscore and *_geojson*
      _exclude_cleaner: excludeCleaner, // may be null
    });

    if (error) throw error;

    // data should contain final_geojson & area_km2 (from SQL).
    // If you compute pricing in JS, do it here:
    const km2 = Number(data?.area_km2 ?? 0);
    const rate = Number(process.env.RATE_PER_KM2_PER_MONTH ?? 1);
    const min = Number(process.env.MIN_PRICE_PER_MONTH ?? 1);
    const months = Number(body.months ?? 1);
    const monthly_price = km2 > 0 ? Math.max(rate * km2, min) : min;
    const total_price = monthly_price * months;

    return new Response(
      JSON.stringify({
        ok: true,
        final_geojson: data?.final_geojson ?? null,
        area_km2: km2,
        monthly_price,
        total_price,
        months,
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
