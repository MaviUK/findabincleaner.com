// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  // Allow both GET and POST (your frontend is currently POSTing)
  if (!["GET", "POST"].includes(event.httpMethod)) {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  let areaId = "";
  let categoryId = "";
  let slot = 1;

  try {
    if (event.httpMethod === "GET") {
      const qs = event.queryStringParameters || {};
      areaId = String(qs.areaId || qs.area_id || "").trim();
      categoryId = String(qs.categoryId || qs.category_id || "").trim();
      slot = Number(qs.slot || 1);
    } else {
      const body = JSON.parse(event.body || "{}");
      areaId = String(body.areaId || body.area_id || "").trim();
      categoryId = String(body.categoryId || body.category_id || "").trim();
      slot = Number(body.slot || 1);
    }
  } catch (e) {
    return json({ ok: false, error: "Invalid request payload" }, 400);
  }

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

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return json({ ok: false, error: "No preview returned" }, 404);

    const total = Number(row.total_km2 ?? 0) || 0;
    const avail = Number(row.available_km2 ?? 0) || 0;

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

        coverage_pct: total > 0 ? (avail / total) * 100 : 0,

        // original service area GeoJSON (your RPC currently returns sa.gj)
        gj: row.gj || null,
      },
      200
    );
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
