// netlify/functions/area-preview.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE // RLS bypass for RPC
);

export default async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Use POST with JSON body' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Parse JSON body
    let body = {};
    try {
      body = await req.json();
    } catch {}

    const area_id = body.areaId ?? body.area_id;
    const slot = Number(body.slot ?? 1);
    const months = Number(body.months ?? 1);
    const drawnGeoJSON = body.drawnGeoJSON ?? null;
    // Optional: cleaner to exclude from the clip (prevents self-blocking)
    const excludeCleaner = body.cleanerId ?? body.cleaner_id ?? null;

    if (!area_id || !slot) {
      return new Response(JSON.stringify({ error: 'area_id and slot are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Helper: make an RPC call with given args
    const callPreview = (argsObj) =>
      supabase.rpc('get_area_preview', argsObj);

    // First, try the 4-arg signature (…,_exclude_cleaner)
    let data, error;

    ({ data, error } = await callPreview({
      _area_id: area_id,
      _slot: slot,
      _drawn_geojson: drawnGeoJSON,    // may be null
      _exclude_cleaner: excludeCleaner, // may be null
    }));

    // If the function isn’t found (schema cache still has the 3-arg version),
    // fall back to the 3-arg call without _exclude_cleaner.
    const notFoundMsg =
      error?.message && /could not find the function .*get_area_preview/i.test(error.message);

    if (error && notFoundMsg) {
      ({ data, error } = await callPreview({
        _area_id: area_id,
        _slot: slot,
        _drawn_geojson: drawnGeoJSON,
      }));
    }

    // Some deployments return a “could not choose best candidate function” error
    // when both versions exist during cache churn — retry with 3-arg too.
    const ambiguousMsg =
      error?.message && /could not choose the best candidate function/i.test(error.message);

    if (error && ambiguousMsg) {
      ({ data, error } = await callPreview({
        _area_id: area_id,
        _slot: slot,
        _drawn_geojson: drawnGeoJSON,
      }));
    }

    if (error) throw error;

    return new Response(
      JSON.stringify({
        ok: true,
        ...(data || {}),
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
