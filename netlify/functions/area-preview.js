// netlify/functions/area-preview.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { area_id, slot, drawnGeoJSON } = body || {};

    const months = Number(body?.months) > 0 ? Number(body.months) : 1;
    if (!area_id || !slot || !drawnGeoJSON) {
      return new Response(JSON.stringify({ error: 'area_id, slot, drawnGeoJSON required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Call your RPC that returns the *billable* geometry and its area.
    // Expected return shape (suggested):
    // { final_geojson: jsonb | null, area_km2: numeric }
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: area_id,
      _slot: slot,
      _drawn_geojson: drawnGeoJSON,
    });
    if (error) throw error;

    // Defensive numeric coercion
    const areaKm2 =
      data && typeof data.area_km2 !== 'undefined'
        ? Number(data.area_km2)
        : 0;

    const RATE = Number(process.env.RATE_PER_KM2_PER_MONTH ?? 15); // £/km²/month
    const MIN  = Number(process.env.MIN_PRICE_PER_MONTH ?? 1);      // £/month

    const monthly_price = Math.max(MIN, areaKm2 * RATE);
    const total_price   = monthly_price * months;

    return new Response(
      JSON.stringify({
        ok: true,
        final_geojson: data?.final_geojson ?? null,
        area_km2: areaKm2,              // number
        monthly_price,                  // number
        total_price,                    // number
      }),
      {
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        },
      }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e?.message || 'failed' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
};
