// /netlify/functions/area-preview.js
import { createClient } from '@supabase/supabase-js';

// Service-role client (RLS bypass for RPCs)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// simple helpers
const toNum = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const clamp2 = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);

export default async (req) => {
  try {
    // we only accept POST with JSON
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Use POST with JSON body' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    }

    // parse body
    let body = null;
    try {
      body = await req.json();
    } catch {
      // keep body as null; will fail validation below
    }

    const area_id = body?.areaId || body?.area_id;
    const slot = Number(body?.slot ?? 1) || 1;
    const months = Math.max(1, Number(body?.months ?? 1) || 1);

    // IMPORTANT: treat drawn geometry as optional, and only pass it if it looks like GeoJSON
    const drawnGeoJSONRaw =
      body?.drawnGeoJSON ?? body?.drawn_geojson ?? body?._drawn_geojson ?? null;
    const drawnGeoJSON =
      drawnGeoJSONRaw && typeof drawnGeoJSONRaw === 'object' && drawnGeoJSONRaw.type
        ? drawnGeoJSONRaw
        : null;

    if (!area_id || !slot) {
      return new Response(JSON.stringify({ error: 'area_id and slot are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Call the SQL function. It has the signature:
    // get_area_preview(_area_id uuid, _slot integer, _drawn_geojson jsonb)
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: area_id,
      _slot: slot,
      _drawn_geojson: drawnGeoJSON, // may be null
    });

    if (error) throw error;

    // Expecting SQL to return: { final_geojson, area_km2, monthly_price, total_price }
    // But we’ll compute prices if they’re missing.
    const area_km2 = toNum(data?.area_km2);

    // pricing env (strings -> numbers)
    const RATE = Number(process.env.RATE_PER_KM2_PER_MONTH ?? 1);
    const MIN = Number(process.env.MIN_PRICE_PER_MONTH ?? 1);

    let monthly_price = toNum(data?.monthly_price);
    let total_price = toNum(data?.total_price);

    if (monthly_price === null && area_km2 !== null) {
      monthly_price = Math.max(MIN, clamp2(area_km2 * RATE));
    }
    if (total_price === null && monthly_price !== null) {
      total_price = clamp2(monthly_price * months);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        final_geojson: data?.final_geojson ?? null,
        area_km2,
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
