import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// Small helper
const num = (v) => (v == null ? null : Number(v));

const jsonHeaders = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Content-Type, Authorization',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

export default async (req) => {
  try {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: jsonHeaders });
    }

    // Accept GET (query) OR POST (JSON body)
    let area_id, slot, months, drawnGeoJSON;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      area_id = url.searchParams.get('area_id') ?? url.searchParams.get('areaId');
      slot = num(url.searchParams.get('slot'));
      months = num(url.searchParams.get('months')) ?? 1;
      // (rare for GET) drawnGeoJSON not expected
    } else {
      // Be robust to bad/empty bodies:
      let raw = '';
      try {
        raw = await req.text();
      } catch {}
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        // if the client sent form-encoded by mistake:
        body = {};
      }
      // Allow both snake_case and camelCase
      area_id = body.area_id ?? body.areaId ?? null;
      slot = num(body.slot);
      months = num(body.months) ?? 1;
      drawnGeoJSON = body.drawnGeoJSON ?? body.drawn_geojson ?? null;

      // Debug (shows in Netlify function logs)
      console.log('[area-preview] body parsed:', { area_id, slot, months, hasDrawn: !!drawnGeoJSON });
    }

    if (!area_id || !slot) {
      return new Response(JSON.stringify({ error: 'area_id and slot are required' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    // Call your SQL preview function (explicit arg names to disambiguate overloads)
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: area_id,
      _slot: slot,
      _drawn_geojson: drawnGeoJSON ?? null,
    });
    if (error) throw error;

    // Compute/normalize prices if SQL didn’t return them
    const KM2 = Number(data?.area_km2 ?? 0);
    const RATE = Number(process.env.RATE_PER_KM2_PER_MONTH ?? 0); // e.g. 1.0
    const MIN  = Number(process.env.MIN_PRICE_PER_MONTH ?? 1);    // e.g. 1.0
    const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

    const monthly_from_sql = Number(data?.monthly_price ?? NaN);
    const monthly_price = Number.isFinite(monthly_from_sql)
      ? monthly_from_sql
      : Math.max(MIN, r2(KM2 * RATE));
    const total_price = r2(monthly_price * Number(months || 1));

    return new Response(
      JSON.stringify({
        ok: true,
        final_geojson: data?.final_geojson ?? null,
        area_km2: KM2,
        monthly_price,
        total_price,
      }),
      { headers: jsonHeaders }
    );
  } catch (e) {
    console.error('[area-preview] error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'failed' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
};
