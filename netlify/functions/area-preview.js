// netlify/functions/area-preview.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE // RLS bypass for RPC
);

export default async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Use POST with JSON body' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Read JSON body
    let body = null;
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const area_id = body.areaId || body.area_id;
    const slot = Number(body.slot ?? 1);
    const months = Number(body.months ?? 1);
    const drawnGeoJSON = body.drawnGeoJSON ?? null;

    // NEW: optional cleaner to exclude (prevents “self-blocking”)
    const excludeCleaner = body.cleanerId || body.cleaner_id || null;

    if (!area_id || !slot) {
      return new Response(JSON.stringify({ error: 'area_id and slot are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Always call the 3-arg version (and include the cleaner exclusion)
    // Expecting: { final_geojson, area_km2, monthly_price, total_price }
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: area_id,
      _slot: slot,
      _drawn_geojson: drawnGeoJSON,   // may be null
      _exclude_cleaner: excludeCleaner // may be null; disambiguates overloaded fn
    });

    if (error) throw error;

    return new Response(
      JSON.stringify({
        ok: true,
        ...(data || {}),
        months,
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || 'failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
