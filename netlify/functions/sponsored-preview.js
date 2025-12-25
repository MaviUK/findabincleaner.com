import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

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

  const { areaId, categoryId, slot = 1 } = body;

  if (!areaId || !categoryId) {
    return json(400, { ok: false, error: "Missing areaId or categoryId" });
  }

  try {
    // ✅ Call the FIXED DB function
    const { data, error } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_category_id: categoryId,
      p_slot: slot,
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;

    if (!row) {
      return json(404, { ok: false, error: "Area not found" });
    }

    return json(200, {
      ok: true,
      total_km2: row.total_km2,
      available_km2: row.available_km2,
      sold_out: row.sold_out,
      reason: row.reason,
      geojson: row.gj,

      // pricing handled elsewhere, but keep shape stable
      rate_per_km2: 1,
      price_cents: Math.max(100, Math.round(row.available_km2 * 100)),
    });
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    return json(500, { ok: false, error: "Preview failed" });
  }
};
