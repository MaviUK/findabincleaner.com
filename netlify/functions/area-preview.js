// netlify/functions/area-preview.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const JSON_HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
  pragma: 'no-cache',
  expires: '0',
};

export default async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  try {
    // Parse body (tolerate missing content-type)
    let body = {};
    try {
      body = await req.json();
    } catch {
      // fallthrough – will be validated below
    }

    const { area_id, slot, months, drawnGeoJSON } = body || {};

    // Validate required params: area_id + slot. drawnGeoJSON is OPTIONAL.
    if (!area_id || !slot) {
      return new Response(
        JSON.stringify({ error: 'area_id and slot are required' }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    // Coerce and sanity-check slot/months
    const slotInt = Number(slot);
    if (![1, 2, 3].includes(slotInt)) {
      return new Response(
        JSON.stringify({ error: 'slot must be 1, 2, or 3' }),
        { status: 400, headers: JSON_HEADERS }
      );
    }
    const monthsInt = Math.max(1, Number(months || 1));

    // Call RPC. Pass drawn geometry when provided, otherwise null so the RPC
    // can use the stored service area geometry.
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: area_id,
      _slot: slotInt,
      _drawn_geojson: drawnGeoJSON || null,
    });

    if (error) {
      // Surface Postgres error message
      return new Response(JSON.stringify({ error: error.message || 'RPC error' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    // Expect RPC to return { final_geojson, area_km2 }
    const areaKm2 = Number(data?.area_km2) || 0;

    // Pricing: simple example via env vars (defaults included)
    const rate = Number(process.env.RATE_PER_KM2_PER_MONTH || 15); // £/km²/month
    const min = Number(process.env.MIN_PRICE_PER_MONTH || 5);      // £ minimum / month
    const monthly_price = Math.max(min, areaKm2 * rate);
    const total_price = monthly_price * monthsInt;

    return new Response(
      JSON.stringify({
        ok: true,
        ...data, // { final_geojson, area_km2 }
        months: monthsInt,
        monthly_price,
        total_price,
      }),
      { headers: JSON_HEADERS }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e?.message || 'failed' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
