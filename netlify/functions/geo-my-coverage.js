// netlify/functions/geo-my-coverage.js
import { createClient } from "@supabase/supabase-js";

// Server-side Supabase (uses Service Role so it can read geometries)
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY
);

// CORS helper
const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization",
};

export default async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const me = url.searchParams.get("me");
    if (!me) return json({ error: "Missing ?me" }, 400);

    // Call the SQL helper we created earlier:
    //   create or replace function public.my_coverage_geojson(p_cleaner uuid) returns jsonb
    const { data, error } = await sb.rpc("my_coverage_geojson", { p_cleaner: me });
    if (error) throw error;

    // my_coverage_geojson returns a single geometry (or null).
    // Wrap it as a FeatureCollection for the map.
    const fc = toFeatureCollection(data);
    return json(fc);
  } catch (e) {
    console.error(e);
    return json({ error: e.message || "Failed to fetch coverage" }, 500);
  }
};

function toFeatureCollection(geometryJson) {
  if (!geometryJson) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: geometryJson }],
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
