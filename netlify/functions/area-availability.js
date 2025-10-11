// netlify/functions/area-availability.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export default async (req) => {
  try {
    const url = new URL(req.url);
    const area_id   = url.searchParams.get('area_id');
    const slot      = parseInt(url.searchParams.get('slot') || '1', 10);
    const cleaner_id = url.searchParams.get('cleaner_id'); // optional

    if (!area_id || !slot) {
      return new Response(JSON.stringify({ error: 'area_id and slot are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const { data, error } = await supabase.rpc('get_area_availability', {
      _area_id: area_id,
      _slot: slot,
      _exclude_cleaner: cleaner_id || null,
    });

    if (error) throw error;

    // Normalize RETURNS TABLE to a single row
    const row = Array.isArray(data) ? (data[0] || {}) : (data || {});
    const ok = !!row.ok;

    return new Response(JSON.stringify({
      ok,
      existing: row.existing ?? null,
      available: row.available ?? null
    }), {
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
