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

    // Read JSON body (no query-string expected here)
    let body = {};
    try {
      body = await req.json();
    } catch {
      // keep empty
    }

    const area_id = body.area_id || body.areaId;
    const slot = Number(body.slot || 1);
    const months = Number(body.months || 1);
    const drawnGeoJSON = body.drawnGeoJSON ?? null; // may be null

    if (!area_id || !slot) {
      return new Response(JSON.stringify({ error: 'area_id and slot are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Always call the 3-arg overload to avoid integer/smallint ambiguity.
    // SQL signature: get_area_preview(area_id uuid, slot smallint, drawn_geojson jsonb)
    const { data, error } = await supabase.rpc('get_area_preview', {
      area_id,
      slot,
      drawn_geojson: drawnGeoJSON, // jsonb or null
    });

    if (error) throw error;

    // Expecting: { final_geojson, area_km2, monthly_price?, total_price? } from SQL
    return new Response(
      JSON.stringify({
        ok: true,
        months,
        ...data,
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
