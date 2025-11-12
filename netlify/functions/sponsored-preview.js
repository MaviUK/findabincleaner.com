// netlify/functions/sponsored-preview.js
const { createClient } = require("@supabase/supabase-js");

/**
 * Reads a numeric env value safely
 */
function readIntEnv(name, fallback) {
  const raw = process.env[name];
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method not allowed" };
    }

    const body = JSON.parse(event.body || "{}");
    const areaId = body.areaId;
    const slot = Number(body.slot) > 0 ? Number(body.slot) : 1;

    if (!areaId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: "Missing areaId" }),
      };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // ------- 1) Fetch preview using your DB RPC -------
    const { data, error } = await supabase.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });

    if (error) {
      console.error("RPC error", error);
      return {
        statusCode: 500,
        body: JSON.stringify({
          ok: false,
          error: `RPC failed: ${error.message}`,
        }),
      };
    }

    const row = Array.isArray(data) ? data[0] : data;

    if (!row) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          ok: false,
          error: "Area not found",
        }),
      };
    }

    const totalKm2 = Number(row.total_km2) || 0;
    const availableKm2 = Math.max(0, Number(row.available_km2) || 0);
    const soldOut = Boolean(row.sold_out);
    const reason = row.reason || null;

    // ------- 2) Pricing -------
    const ratePerKm2Pennies = readIntEnv("RATE_PER_KM2_PER_MONTH", 100);
    const minMonthlyPennies = readIntEnv("MIN_PRICE_PER_MONTH", 100);

    const rawMonthly = Math.round(availableKm2 * ratePerKm2Pennies);
    const monthlyPricePennies = Math.max(minMonthlyPennies, rawMonthly);

    const coveragePct =
      totalKm2 > 0 ? ((totalKm2 - availableKm2) / totalKm2) * 100 : 100;

    // ------- 3) Return preview -------
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        totalKm2,
        availableKm2,
        soldOut,
        reason,
        coveragePct,
        pricePerKm2Pennies: ratePerKm2Pennies,
        minMonthlyPennies,
        monthlyPricePennies,
        gj: row.gj || null,
      }),
    };
  } catch (err) {
    console.error("Preview crash", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
