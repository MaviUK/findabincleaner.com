// netlify/functions/sponsored-preview.js
// SANITY STUB: no Supabase, just returns a fake "OK" preview.
// This should *eliminate the 502* and prove the route + modal wiring are fine.

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed",
    };
  }

  try {
    // Just log that we were actually invoked
    console.log("[sponsored-preview] STUB handler called");

    // Return a fake-but-valid preview
    const total_km2 = 101.197;
    const available_km2 = 101.197;
    const area_km2 = available_km2;
    const coverage_pct = 100;

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        reason: "ok_stub",
        sold_out: false,
        total_km2,
        available_km2,
        area_km2,
        coverage_pct,
        geojson: null,
      }),
    };
  } catch (err) {
    console.error("[sponsored-preview] STUB unexpected error:", err);
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: false,
        reason: "stub_internal_error",
        error: err && err.message ? err.message : String(err),
      }),
    };
  }
};
