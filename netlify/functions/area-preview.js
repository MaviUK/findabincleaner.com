// netlify/functions/area-preview.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE // RLS bypass for RPC
);

export default async (req) => {
  try {
    // We expect POST with JSON body
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Use POST with JSON body' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Read JSON (no query-string expected here)
    let body = {};
    try {
      body = await req.json();
    } catch {
      // keep empty
    }

    const area_id = body.areaId || body.area_id;
    const slot = Number(body.slot ?? 1);
    const months = Number(body.months ?? 1);
    const drawnGeoJSON =
      body.drawnGeoJSON ?? body.drawn_geojson ?? null; // may be null

    if (!area_id || !slot) {
      return new Response(JSON.stringify({ error: 'area_id and slot are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Call SQL function — always pass all 3 named args to avoid ambiguity
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: area_id,   // match SQL arg name
      _slot: slot,         // match SQL arg name
      _drawn_geojson: drawnGeoJSON, // match SQL arg name
    });

    if (error) throw error;

    // Expecting (from SQL):
    //  final_geojson jsonb, area_km2 numeric, monthly_price numeric, total_price numeric
    let {
      final_geojson,
      area_km2,
      monthly_price,
      total_price,
    } = data || {};

    // Defensive coercion
    const toNum = (v) => {
      if (v == null) return null;
      if (typeof v === 'number') return Number.isFinite(v) ? v : null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    area_km2 = toNum(area_km2);

    // If SQL didn’t compute prices, compute here from env
    const RATE = toNum(process.env.RATE_PER_KM2_PER_MONTH) ?? 1;
    const MIN  = toNum(process.env.MIN_PRICE_PER_MONTH) ?? 1;

    if (monthly_price == null) {
      if (area_km2 == null) {
        monthly_price = null;
      } else {
        const calc = Math.max(MIN, area_km2 * RATE);
        monthly_price = Math.round(calc * 100) / 100;
      }
    } else {
      monthly_price = toNum(monthly_price);
    }

    if (total_price == null) {
      total_price = monthly_price == null ? null : Math.round((monthly_price * months) * 100) / 100;
    } else {
      total_price = toNum(total_price);
    }

    // Some drivers serialize jsonb as string; try to parse to object if that happens
    if (typeof final_geojson === 'string') {
      try { final_geojson = JSON.parse(final_geojson); } catch {}
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
