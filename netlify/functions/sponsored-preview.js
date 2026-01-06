import { createClient } from "@supabase/supabase-js";

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const EPS = 1e-6;

/**
 * Lazy init so missing env vars don't crash at import-time.
 * Supports both SUPABASE_SERVICE_ROLE (your Netlify var) and SUPABASE_SERVICE_ROLE_KEY.
 */
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    // This exact error will show in Netlify function logs
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE (service role key) in Netlify env."
    );
  }

  return createClient(url, key);
}

export default async (req) => {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "Invalid JSON" });
  }

  const areaId = String(body.areaId || body.area_id || "").trim();
  const categoryId = String(body.categoryId || body.category_id || "").trim();
  const slot = Number(body.slot ?? 1);

  if (!areaId || !categoryId) {
    return json(400, { ok: false, error: "Missing areaId or categoryId" });
  }
  if (!Number.isFinite(slot) || slot < 1) {
    return json(400, { ok: false, error: "Invalid slot" });
  }

  try {
    const sb = getSupabaseAdmin();

    // IMPORTANT: call the INTERNAL function that returns geojson + ewkt
    const { data, error } = await sb.rpc("area_remaining_preview_internal", {
      p_area_id: areaId,
      p_category_id: categoryId,
      p_slot: slot,
    });
    if (error) throw error;

    // Supabase RPC returns an array for RETURNS TABLE
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return json(404, { ok: false, error: "Area not found" });

    const totalKm2 = Number(row.total_km2 ?? 0) || 0;
    const availableKm2 = Number(row.available_km2 ?? 0) || 0;

    const soldOut =
      Boolean(row.sold_out) ||
      !Number.isFinite(availableKm2) ||
      availableKm2 <= EPS;

    const ratePerKm2 =
      Number(
        process.env.RATE_GOLD_PER_KM2_PER_MONTH ??
          process.env.RATE_PER_KM2_PER_MONTH ??
          0
      ) || 0;

    const priceCents = soldOut
      ? 0
      : Math.max(100, Math.round(Math.max(availableKm2, 0) * ratePerKm2 * 100));

    return json(200, {
      ok: true,
      total_km2: totalKm2,
      available_km2: availableKm2,
      sold_out: soldOut,
      reason: row.reason ?? (soldOut ? "no_remaining" : "ok"),

      // ✅ these now match your updated SQL function output
      geojson: row.geojson ?? null,
      ewkt: row.ewkt ?? null,

      rate_per_km2: ratePerKm2,
      price_cents: priceCents,
    });
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    return json(500, { ok: false, error: e?.message || "Preview failed" });
  }
};
