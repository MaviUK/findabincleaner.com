// netlify/functions/sponsored-preview.js
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

const EPS = 1e-6;

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
    // IMPORTANT:
    // This MUST be the geometry-aware function (see SQL below).
    const { data, error } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_category_id: categoryId,
      p_slot: slot,
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return json(404, { ok: false, error: "Area not found" });

    const totalKm2 = Number(row.total_km2 ?? 0) || 0;
    const availableKm2 = Number(row.available_km2 ?? 0) || 0;

    const soldOut =
      Boolean(row.sold_out) || !Number.isFinite(availableKm2) || availableKm2 <= EPS;

    const ratePerKm2 = Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? 1) || 1;

    // Price = available * rate, floor £1.00 if any availability, else £0.
    const priceCents = soldOut
      ? 0
      : Math.max(100, Math.round(Math.max(availableKm2, 0) * ratePerKm2 * 100));

    return json(200, {
      ok: true,
      total_km2: totalKm2,
      available_km2: availableKm2,
      sold_out: soldOut,
      reason: row.reason ?? (soldOut ? "no_remaining" : "ok"),
      geojson: row.gj ?? null,
      rate_per_km2: ratePerKm2,
      price_cents: priceCents,
    });
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    return json(500, { ok: false, error: e?.message || "Preview failed" });
  }
};
