// netlify/functions/area-preview.js
const { createClient } = require('@supabase/supabase-js');

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

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: JSON_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch (_) {}

    const { area_id, slot, months, drawnGeoJSON } = body || {};

    if (!area_id || !slot) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'area_id and slot are required' }),
      };
    }

    const slotInt = Number(slot);
    if (![1, 2, 3].includes(slotInt)) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'slot must be 1, 2, or 3' }),
      };
    }

    const monthsInt = Math.max(1, Number(months || 1));

    // Call your RPC; allow NULL drawn geometry (fall back to stored area)
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: area_id,
      _slot: slotInt,
      _drawn_geojson: drawnGeoJSON || null,
    });

    if (error) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: error.message || 'RPC error' }),
      };
    }

    const areaKm2 = Number(data?.area_km2) || 0;
    const rate = Number(process.env.RATE_PER_KM2_PER_MONTH || 15); // £/km²/month
    const min = Number(process.env.MIN_PRICE_PER_MONTH || 5);      // £ minimum / month
    const monthly_price = Math.max(min, areaKm2 * rate);
    const total_price = monthly_price * monthsInt;

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        ...data,               // { final_geojson, area_km2 }
        months: monthsInt,
        monthly_price,
        total_price,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: e?.message || 'failed' }),
    };
  }
};
