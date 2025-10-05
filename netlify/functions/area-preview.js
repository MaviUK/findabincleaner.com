// netlify/functions/area-preview.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { area_id, slot, drawnGeoJSON } = await req.json();

    if (!area_id || !slot || !drawnGeoJSON) {
      return new Response(JSON.stringify({ error: 'area_id, slot, drawnGeoJSON required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: area_id,
      _slot: slot,
      _drawn_geojson: drawnGeoJSON,
    });
    if (error) throw error;

    // Add pricing here if you like (example):
    const rate = Number(process.env.RATE_PER_KM2_PER_MONTH || 15); // £15 / km² / month (example)
    const min = Number(process.env.MIN_PRICE_PER_MONTH || 5);      // £5 minimum (example)
    const months = 1; // for preview we can assume 1
    const monthly_price = Math.max(min, (Number(data?.area_km2) || 0) * rate);
    const total_price = monthly_price * months;

    return new Response(JSON.stringify({
      ok: true,
      ...data, // { final_geojson, area_km2 }
      monthly_price,
      total_price,
    }), {
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
