// netlify/functions/sponsored-preview.js

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceRole) {
  console.warn(
    "[sponsored-preview] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE environment variables."
  );
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole, {
  auth: { persistSession: false },
});

export const handler = async (event) => {
  // Simple GET ping for sanity checks
  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        message: "sponsored-preview is alive",
        method: "GET",
      }),
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, message: "Method not allowed" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const areaId = body.areaId;
    const slot = Number(body.slot) || 1;

    if (!areaId) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: false, message: "Missing areaId" }),
      };
    }

    // Call your Postgres helper: area_remaining_preview(p_area_id uuid, p_slot int)
    const { data, error } = await supabaseAdmin.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });

    if (error) {
      console.error("[sponsored-preview] Supabase RPC error:", error);
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: false,
          message: "Failed to compute preview",
          error: error.message || String(error),
        }),
      };
    }

    const row = Array.isArray(data) ? data[0] : data;

    if (!row) {
      return {
        statusCode: 404,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: false,
          message: "No preview row returned from area_remaining_preview",
        }),
      };
    }

    // Normalise the shape the frontend expects
    const result = {
      ok: true,
      total_km2: row.total_km2 ?? 0,
      available_km2: row.available_km2 ?? 0,
      sold_out: !!row.sold_out,
      reason: row.reason ?? null,
      gj: row.gj ?? null,
    };

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error("[sponsored-preview] Unhandled error:", err);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: false,
        message: "Unexpected error in sponsored-preview",
        error: err && err.message ? err.message : String(err),
      }),
    };
  }
};
