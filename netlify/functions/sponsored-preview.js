import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// small epsilon so we treat tiny leftovers as zero
const EPS = 1e-6;

export default async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const areaId = (body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot || 1);
  const businessId = (body.businessId || body.cleanerId || "").trim();

  // ✅ NEW: category support
  const categoryIdRaw = (body.categoryId || body.category_id || "").trim();
  const categoryId = categoryIdRaw || null;

  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);
  if (![1].includes(slot)) {
    // only one featured slot for now
    return json({ ok: false, error: "Invalid slot" }, 400);
  }

  try {
    // 1) Ask Postgres how much of THIS area is still purchasable,
    //    after subtracting existing sponsorships for this slot
    //    ✅ now scoped to the current industry (category_id)
    const { data: previewData, error: prevErr } = await sb.rpc(
      "area_remaining_preview",
      {
        p_area_id: areaId,
        p_slot: slot,
        p_category_id: categoryId, // ✅ NEW
      }
    );
    if (prevErr) throw prevErr;

    const row = Array.isArray(previewData)
      ? previewData[0] || {}
      : previewData || {};

    let total_km2 = Number(row.total_km2 ?? 0) || 0;
    let available_km2 = Number(row.available_km2 ?? 0) || 0;
    const sold_out_flag = Boolean(row.sold_out);
    const reason_raw = row.reason || null;
    const gj = row.gj ?? null;

    if (!Number.isFinite(total_km2)) total_km2 = 0;
    if (!Number.isFinite(available_km2)) available_km2 = 0;

    const sold_out = sold_out_flag || available_km2 <= EPS;
    if (sold_out) available_km2 = 0;

    // 2) Pricing
    const rate_per_km2 =
      Number(
        process.env.RATE_GOLD_PER_KM2_PER_MONTH ??
          process.env.RATE_PER_KM2_PER_MONTH ??
          0
      ) || 0;

    const price_cents = sold_out
      ? 0
      : Math.round(Math.max(available_km2, 0) * rate_per_km2 * 100);

    return json({
      ok: true,
      sold_out,
      available_km2: Math.max(0, available_km2),
      total_km2: Math.max(0, total_km2),
      rate_per_km2,
      price_cents,
      geojson: gj,
      reason: sold_out ? reason_raw || "no_remaining" : "ok",
      category_id: categoryId, // helpful for debugging
    });
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
