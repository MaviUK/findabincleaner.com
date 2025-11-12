// netlify/functions/sponsored-preview.js
const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { areaId, slot } = JSON.parse(event.body || "{}");

    if (!areaId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: "Missing areaId" }),
      };
    }

    // IMPORTANT: slot in DB is 1-based; default to 1 if absent
    const slotNum = Number.isFinite(Number(slot)) && Number(slot) > 0 ? Number(slot) : 1;

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // Use the new preview function directly
    const { data, error } = await supabase.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slotNum,
    });

    if (error) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          ok: false,
          error: `RPC area_remaining_preview failed: ${error.message}`,
        }),
      };
    }

    const row = (Array.isArray(data) ? data[0] : data) || null;

    if (!row) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          ok: false,
          error: "No preview data returned",
        }),
      };
    }

    // Normalize & trust server fields
    const totalKm2 = Number(row.total_km2) || 0;
    const availableKm2 = Math.max(0, Number(row.available_km2) || 0);
    const soldOut = Boolean(row.sold_out);
    const reason = row.reason || "unknown";
    const gj = row.gj ?? null;

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        totalKm2,
        availableKm2,
        soldOut,
        reason,
        // The UI chooses whether to render gj preview
        gj,
        slot: slotNum,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: e.message }),
    };
  }
};
