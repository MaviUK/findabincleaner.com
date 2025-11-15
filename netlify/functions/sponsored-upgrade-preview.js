// netlify/functions/sponsored-upgrade-preview.js

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// JSON helper
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const BLOCKING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);

const EPS = 1e-6;

export default async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const businessId = String(body.businessId || body.cleanerId || "").trim();
  const areaId = String(body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot || 1);

  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);
  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (![1].includes(slot))
    return json({ ok: false, error: "Invalid slot" }, 400);

  try {
    //
    // 1) Look up existing sponsorship for this business + area + slot
    //
    const { data: sub, error: subErr } = await sb
      .from("sponsored_subscriptions")
      .select(
        "id, business_id, area_id, slot, status, area_km2, price_cents, stripe_subscription_id"
      )
      .eq("business_id", businessId)
      .eq("area_id", areaId)
      .eq("slot", slot)
      .maybeSingle();

    if (subErr) throw subErr;

    const hasExisting = !!sub && BLOCKING.has(String(sub.status || "").toLowerCase());
    const current_area_km2 = hasExisting
      ? Number(sub.area_km2 ?? 0) || 0
      : 0;
    const current_price_cents = hasExisting
      ? Number(sub.price_cents ?? 0) || 0
      : 0;

    //
    // 2) Ask DB how much area is still free for this area+slot
    //    (this function already subtracts ALL blocking coverage from ANY business)
    //
    const { data: previewRow, error: prevErr } = await sb.rpc(
      "area_remaining_preview",
      {
        p_area_id: areaId,
        p_slot: slot,
      }
    );
    if (prevErr) throw prevErr;

    const row = Array.isArray(previewRow)
      ? previewRow[0] || {}
      : previewRow || {};

    const total_km2 = Number(row.total_km2 ?? 0) || 0;
    const available_km2 =
      Number(row.available_km2 ?? row.area_km2 ?? 0) || 0;

    // This "available_km2" is the extra free area that could be bought now.
    const extra_area_km2 = Math.max(0, available_km2);
    const new_total_area_km2 = current_area_km2 + extra_area_km2;

    //
    // 3) Pricing
    //
    const rate_per_km2 =
      Number(
        process.env.RATE_GOLD_PER_KM2_PER_MONTH ??
          process.env.RATE_PER_KM2_PER_MONTH ??
          0
      ) || 0;

    const new_price_cents = Math.round(
      Math.max(0, new_total_area_km2) * rate_per_km2 * 100
    );

    // If there's effectively no extra area, treat as sold-out for upgrade
    const noExtra = extra_area_km2 <= EPS;

    return json({
      ok: true,
      has_existing: hasExisting,
      current_area_km2,
      extra_area_km2,
      new_total_area_km2,
      current_price_cents,
      new_price_cents,
      total_km2,
      available_km2,
      geojson: row.gj ?? null, // free sub-region to highlight
      sold_out: noExtra,
      reason: noExtra ? "no_extra" : "ok",
    });
  } catch (e) {
    console.error("sponsored-upgrade-preview error:", e);
    return json(
      { ok: false, error: e?.message || "Server error in upgrade preview" },
      500
    );
  }
};
