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

    // parse JSON (no query-string inputs here)
    let body = {};
    try { body = await req.json(); } catch (_) {}

    // accept either areaId/slot or area_id/slot
    const area_id = body.area_id || body.areaId;
    const slot    = body.slot != null ? Number(body.slot) : Number(body?.slot);
    // optional cleaner (for “exclude me” preview during edits)
    const cleaner_id = body.cleaner_id || body.cleanerId || null;

    // IMPORTANT: pass GeoJSON as an object (jsonb), not a string
    let drawn = body.drawnGeoJSON ?? body.drawn_geojson ?? null;
    if (typeof drawn === 'string') {
      try { drawn = JSON.parse(drawn); } catch { drawn = null; }
    }

    if (!area_id || !Number.isFinite(slot)) {
      return new Response(JSON.stringify({ error: 'area_id and slot are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Call the 4-arg overload explicitly by name
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: area_id,          // uuid
      _slot: slot,                // integer
      _drawn_geojson: drawn,      // jsonb (null OK)
      _exclude_cleaner: cleaner_id // uuid (null OK)
    });

    if (error) {
      // bubble up SQL errors verbatim so we can see them in the console
      throw error;
    }

    // data is: { final_geojson, area_km2, monthly_price, total_price }
    return new Response(
      JSON.stringify({ ok: true, ...data }),
      { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e?.message || 'failed' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}
