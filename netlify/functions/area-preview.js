import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// money helpers
const toPennies = (n) => Math.round(Number(n) * 100);
const fromPennies = (p) => Math.round(Number(p)) / 100;

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

    const area_id = body.areaId ?? body.area_id ?? null;
    const slot = Number(body.slot ?? 1);
    const months = Math.max(1, Number(body.months ?? 1));
    const drawnGeoJSON = body.drawnGeoJSON ?? null;   // MultiPolygon from UI

    if (!area_id || !slot) {
      return new Response(JSON.stringify({ error: 'area_id and slot are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // IMPORTANT:
    // 1) Force the 3-arg signature you verified in SQL:
    //    get_area_preview(_area_id uuid, _slot int, _drawn_geojson jsonb)
    // 2) Stringify GeoJSON so Postgres reliably casts to jsonb.
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: area_id,
      _slot: slot,
      _drawn_geojson: drawnGeoJSON ? JSON.stringify(drawnGeoJSON) : null,
    });

    if (error) throw error;

    // Echo a bit to help diagnose if needed
    // (Remove this when happy.)
    // console.log('RPC row:', data);

    const final_geojson = data?.final_geojson ?? null;
    const rawKm2 = data?.area_km2;
    const area_km2 = Number.isFinite(Number(rawKm2)) ? Number(rawKm2) : null;

    // Compute pricing server-side so UI just renders numbers
    let monthly_price = null;
    let total_price = null;
    if (area_km2 && area_km2 > 0) {
      const RATE = Number(process.env.RATE_PER_KM2_PER_MONTH ?? 0);
      const MIN  = Number(process.env.MIN_PRICE_PER_MONTH ?? 0);

      const perMonth = Math.max(
        toPennies(MIN),
        toPennies(area_km2 * RATE)
      );
      monthly_price = fromPennies(perMonth);
      total_price = fromPennies(perMonth * months);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        final_geojson,
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
