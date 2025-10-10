// netlify/functions/area-preview.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE // server-side key
);

// Reusable headers
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'content-type': 'application/json',
};

export default async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const area_id = body?.area_id;
    const slot = Number(body?.slot);
    const drawnGeoJSON = body?.drawnGeoJSON ?? null; // keep since your RPC expects it
    const months = Number(body?.months) > 0 ? Number(body.months) : 1;

    // Basic validation
    if (!area_id || !Number.isFinite(slot) || slot < 1 || !drawnGeoJSON) {
      return new Response(
        JSON.stringify({
          error: 'area_id (uuid), slot (>=1), and drawnGeoJSON are required',
        }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Pricing config
    const RATE = Number(process.env.RATE_PER_KM2_PER_MONTH ?? 15); // £/km²/month
    const MIN = Number(process.env.MIN_PRICE_PER_MONTH ?? 1); // £/month

    // Call your existing safe RPC
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: area_id,
      _slot: slot,
      _drawn_geojson: drawnGeoJSON,
    });

    // If PostGIS precision/intersection throws, degrade gracefully
    if (error) {
      const msg = String(error?.message || '').toLowerCase();
      const isGeos =
        msg.includes('lwgeom_intersection_prec') ||
        msg.includes('geos error') ||
        msg.includes('illegalargumentexception');

      if (isGeos) {
        const monthly_price = Math.max(MIN, 0 * RATE);
        const total_price = monthly_price * months;

        return new Response(
          JSON.stringify({
            ok: true,
            note:
              'Intersection failed due to degenerate geometry; returning empty preview.',
            final_geojson: null,
            area_km2: 0,
            monthly_price,
            total_price,
          }),
          { status: 200, headers: CORS_HEADERS }
        );
      }

      // Unknown error → still don’t 500; return a safe empty preview
      const monthly_price = Math.max(MIN, 0 * RATE);
      const total_price = monthly_price * months;

      return new Response(
        JSON.stringify({
          ok: false,
          note: 'Preview unavailable.',
          final_geojson: null,
          area_km2: 0,
          monthly_price,
          total_price,
          error: error.message,
        }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // Defensive numeric coercion
    const areaKm2 =
      data && typeof data.area_km2 !== 'undefined'
        ? Math.max(0, Number(data.area_km2))
        : 0;

    const monthly_price = Math.max(MIN, areaKm2 * RATE);
    const total_price = monthly_price * months;

    return new Response(
      JSON.stringify({
        ok: true,
        final_geojson: data?.final_geojson ?? null, // your RPC output
        area_km2: areaKm2,
        monthly_price,
        total_price,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (e) {
    // Absolute last-resort safety: never surface a 500 to the UI
    const RATE = Number(process.env.RATE_PER_KM2_PER_MONTH ?? 15);
    const MIN = Number(process.env.MIN_PRICE_PER_MONTH ?? 1);
    const monthly_price = Math.max(MIN, 0);
    const total_price = monthly_price * 1;

    return new Response(
      JSON.stringify({
        ok: false,
        note: 'Unexpected error; returning empty preview.',
        final_geojson: null,
        area_km2: 0,
        monthly_price,
        total_price,
        error: e?.message || 'failed',
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  }
};
