// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const EPS = 1e-6;

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY; // ✅ allow this too

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE (service role key) in Netlify env."
    );
  }

  return createClient(url, key, { auth: { persistSession: false } });
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

    // 1) Find the sponsor_zone for this service area + category
    const { data: zData, error: zErr } = await sb.rpc(
      "get_sponsor_zone_id_for_area",
      {
        p_area_id: areaId,
        p_category_id: categoryId,
      }
    );
    if (zErr) throw zErr;

    const zoneId = (Array.isArray(zData) ? zData[0] : zData) || null;

    // No zone match => treated as sold out / not available
    if (!zoneId) {
      return json(200, {
        ok: true,
        total_km2: 0,
        available_km2: 0,
        sold_out: true,
        reason: "no_zone_match",
        geojson: null,
        ewkt: null,
        rate_per_km2: 0,
        price_cents: 0,
      });
    }

    // 2) Ask DB if it is purchasable (THIS is the source of truth)
    const { data: canData, error: canErr } = await sb.rpc(
      "can_purchase_sponsor_slot",
      {
        p_require_coverage: false,
        p_slot: slot,
        p_zone_id: zoneId,
      }
    );
    if (canErr) throw canErr;

    const canPurchase = Boolean(Array.isArray(canData) ? canData[0] : canData);

    // 3) Optional preview geometry (nice to have)
    // If it fails, we still allow purchase if canPurchase=true.
    let totalKm2 = 0;
    let availableKm2 = 0;
    let geojson = null;
    let ewkt = null;
    let reason = "ok";

    try {
      const { data, error } = await sb.rpc("area_remaining_preview_internal", {
        p_area_id: areaId,
        p_category_id: categoryId,
        p_slot: slot,
      });

      if (!error) {
        const row = Array.isArray(data) ? data[0] : data;
        if (row) {
          totalKm2 = Number(row.total_km2 ?? 0) || 0;
          availableKm2 = Number(row.available_km2 ?? 0) || 0;
          geojson = row.geojson ?? null;
          ewkt = row.ewkt ?? null;
          reason = row.reason ?? reason;
        }
      }
    } catch {
      // ignore preview failures
    }

    // If DB says purchasable, never show sold_out.
    const soldOut = !canPurchase;

    // If purchasable but preview returned 0, give it a tiny non-zero so UI doesn’t block.
    if (!soldOut && (!Number.isFinite(availableKm2) || availableKm2 <= EPS)) {
      availableKm2 = Math.max(0.01, availableKm2 || 0); // 0.01 km² placeholder
    }

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
      zone_id: zoneId,
      total_km2: totalKm2,
      available_km2: availableKm2,
      sold_out: soldOut,
      reason: soldOut ? "cannot_purchase" : reason,

      geojson,
      ewkt,

      rate_per_km2: ratePerKm2,
      price_cents: priceCents,
    });
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    return json(500, { ok: false, error: e?.message || "Preview failed" });
  }
};
