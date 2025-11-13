// netlify/functions/sponsored-preview.js

const { createClient } = require("@supabase/supabase-js");

// Admin Supabase client (SERVICE_ROLE must be set in Netlify env)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  {
    auth: { persistSession: false },
  }
);

/**
 * Input (POST JSON):
 *   {
 *     businessId?: string,
 *     cleanerId?: string,
 *     areaId: string,
 *     slot?: number
 *   }
 *
 * Output (200 JSON):
 *   {
 *     ok: boolean,
 *     reason: string,
 *     sold_out: boolean,
 *     total_km2: number,
 *     available_km2: number,
 *     area_km2: number,
 *     coverage_pct: number,
 *     geojson?: any
 *   }
 */
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed",
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const areaId = body.areaId;
    // back-compat: slot is currently always 1 on the client
    const slot = Number(body.slot || 1);

    if (!areaId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          ok: false,
          reason: "missing_area_id",
        }),
      };
    }

    // Call the Postgres function that you verified in the SQL editor.
    // Adjust arg names here if your function parameters are named differently
    // (e.g. p_area_id / p_slot). The most common pattern is p_area_id + p_slot.
    const { data, error } = await supabase.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });

    if (error) {
      console.error("[sponsored-preview] RPC error:", error);
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: false,
          reason: "rpc_error",
          error: error.message || String(error),
        }),
      };
    }

    const row = Array.isArray(data) && data.length ? data[0] : null;

    if (!row) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: false,
          reason: "area_not_found",
        }),
      };
    }

    const total_km2 = Number(row.total_km2 || 0);
    const available_km2 = Number(row.available_km2 || 0);
    const sold_out = !!row.sold_out;
    const reason = row.reason || (sold_out ? "sold_out" : "ok");

    const area_km2 = available_km2; // what the UI cares about for pricing
    const coverage_pct =
      total_km2 > 0 ? (area_km2 / total_km2) * 100.0 : 0;

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: !sold_out && area_km2 > 0,
        reason,
        sold_out,
        total_km2,
        available_km2,
        area_km2,
        coverage_pct,
        geojson: row.gj || null,
      }),
    };
  } catch (err) {
    console.error("[sponsored-preview] unhandled error:", err);
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: false,
        reason: "internal_error",
        error: err && err.message ? err.message : String(err),
      }),
    };
  }
};
