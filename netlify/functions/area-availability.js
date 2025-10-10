// netlify/functions/area-preview.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE // needs RLS bypass to call SQL function safely
);

export default async (req) => {
  try {
    // We expect a POST with JSON
    const { area_id, slot, months = 1, drawnGeoJSON = null } = await req.json().catch(() => ({}));

    if (!area_id || !slot) {
      return new Response(JSON.stringify({ error: 'area_id and slot are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Call the SQL preview function (disambiguate the overloaded signature by naming args)
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: area_id,
      _slot: slot,
      _drawn_geojson: drawnGeoJSON ?? null,
    });
    if (error) throw error;

    // If your SQL already returns pricing, keep it. Otherwise compute here:
    const KM2 = Number(data?.area_km2 ?? 0);
    const RATE = Number(process.env.RATE_PER_KM2_PER_MONTH ?? 0);   // e.g. 1.0
    const MIN  = Number(process.env.MIN_PRICE_PER_MONTH ?? 1);      // e.g. 1.0

    // round to 2dp
    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

    const monthly_from_sql = Number(data?.monthly_price ?? NaN);
    const monthly_price = Number.isFinite(monthly_from_sql)
      ? monthly_from_sql
      : Math.max(MIN, round2(KM2 * RATE));

    const total_price = round2(monthly_price * Number(months || 1));

    return new Response(
      JSON.stringify({
        ok: true,
        // passthrough from SQL (may be null if nothing billable)
        final_geojson: data?.final_geojson ?? null,
        area_km2: KM2,
        monthly_price,
        total_price,
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
