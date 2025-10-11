// netlify/functions/area-availability.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// normalize any row shapes into what the UI expects
function pickGeom(row) {
  if (!row || typeof row !== 'object') return { existing: null, available: null, ok: false };
  const existing =
    row.existing ?? row.existing_gj ?? row.existing_geojson ?? null;
  const available =
    row.available ?? row.available_gj ?? row.available_geojson ?? null;

  // prefer explicit ok from SQL; else infer from available being present/nonnull/non-empty
  let ok = typeof row.ok === 'boolean' ? row.ok : Boolean(available);
  return { existing, available, ok };
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const area_id    = url.searchParams.get('area_id');
    const slot       = parseInt(url.searchParams.get('slot') || '1', 10);
    const cleaner_id = url.searchParams.get('cleaner_id'); // optional

    if (!area_id || !slot) {
      return new Response(JSON.stringify({ error: 'area_id and slot are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // 1) Try AVAILABILITY first
    const { data: avData, error: avErr } = await supabase.rpc('get_area_availability', {
      _area_id: area_id,
      _slot: slot,
      _exclude_cleaner: cleaner_id || null,
    });

    if (avErr) throw avErr;

    const avRow = Array.isArray(avData) ? (avData[0] || {}) : (avData || {});
    let { existing, available, ok } = pickGeom(avRow);

    // 2) Fallback to PREVIEW when availability provides no geometries
    const noGeom = !existing && !available;
    if (!ok && noGeom) {
      const { data: prevData, error: prevErr } = await supabase.rpc('get_area_preview', {
        _area_id: area_id,
        _slot: slot,
        _drawn_geojson: null,         // UI didn’t draw a clip; just use service area
        _exclude_cleaner: cleaner_id || null,
      });
      if (!prevErr && prevData) {
        // use preview shape as "available" for UI purposes
        const area_km2 = Number(prevData.area_km2 ?? 0);
        available = prevData.final_geojson ?? null;
        ok = area_km2 > 0 && Boolean(available);
      }
    }

    return new Response(JSON.stringify({ ok, existing, available }), {
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || 'failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
