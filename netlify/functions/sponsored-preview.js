// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const json = (body, status = 200) => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const qs = event.queryStringParameters || {};
  const areaId = String(qs.areaId || qs.area_id || "").trim();
  const categoryId = String(qs.categoryId || qs.category_id || "").trim();
  const slot = Number(qs.slot || 1);

  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (!categoryId) return json({ ok: false, error: "Missing categoryId" }, 400);
  if (![1].includes(slot)) return json({ ok: false, error: "Invalid slot" }, 400);

  try {
    const { data, error } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_category_id: categoryId,
      p_slot: slot,
    });

    if (error) throw error;

    const row = Array.isArray(data) ? (data[0] || null) : data;
    if (!row) return json({ ok: false, error: "No preview returned" }, 404);

    const total = Number(row.total_km2 ?? 0) || 0;
    const avail = Number(row.available_km2 ?? 0) || 0;
    const coveragePct = total > 0 ? (avail / total) * 100 : 0;

    return json(
      {
        ok: true,
        area_id: areaId,
        category_id: categoryId,
        slot,
        total_km2: total,
        available_km2: avail,
        sold_out: Boolean(row.sold_out),
        reason: row.reason || "ok",
        coverage_pct: coveragePct,
        gj: row.gj || null,
      },
      200
    );
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
