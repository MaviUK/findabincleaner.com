import { createClient } from "@supabase/supabase-js";
import area from "@turf/area";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

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
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const areaId = (body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot || 1);
  const businessId = (body.businessId || body.cleanerId || "").trim();

  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (![1].includes(slot)) return json({ ok: false, error: "Invalid slot" }, 400);
  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);

  try {
    // 1) Check subscriptions for this area + slot
    const { data: takenRows, error: takenErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id, status")
      .eq("area_id", areaId)
      .eq("slot", slot);

    if (takenErr) throw takenErr;

    const blocking = (takenRows || []).filter((r) =>
      BLOCKING.has(String(r.status || "").toLowerCase())
    );

    const ownerRow = blocking[0] || null;
    const ownedByMe =
      ownerRow && String(ownerRow.business_id) === String(businessId);
    const ownedByOther = ownerRow && !ownedByMe;

    // 2) Compute total area for the modal card
    let total_km2 = null;
    let serviceGeo = null;
    const { data: sa, error: saErr } = await sb
      .from("service_areas")
      .select("gj")
      .eq("id", areaId)
      .maybeSingle();
    if (!saErr && sa?.gj) {
      serviceGeo = sa.gj;
      try {
        const m2 = area(sa.gj);
        if (Number.isFinite(m2)) total_km2 = m2 / 1_000_000;
      } catch {
        // ignore
      }
    }

    // 3) If anyone already owns this slot, treat as sold out for preview
    if (ownedByMe || ownedByOther) {
      return json({
        ok: true,
        sold_out: true,
        available_km2: 0,
        total_km2,
        rate_per_km2: 0,
        price_cents: 0,
        geojson: null, // or serviceGeo if you want to shade whole polygon
        reason: ownedByMe ? "already_owned" : "owned_by_other",
      });
    }

    // 4) No existing blocking subscription → ask DB how much area is free
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

    const remainingField =
      row.available_km2 ?? row.area_km2 ?? row.remaining_km2 ?? 0;

    let remaining_km2 = Number(remainingField);
    if (!Number.isFinite(remaining_km2)) remaining_km2 = 0;

    const geojson = row.gj ?? row.geojson ?? null;

    const sold_out = remaining_km2 <= EPS;

    const rate_per_km2 =
      Number(
        process.env.RATE_GOLD_PER_KM2_PER_MONTH ??
          process.env.RATE_PER_KM2_PER_MONTH ??
          0
      ) || 0;

    const price_cents = Math.round(
      Math.max(remaining_km2, 0) * rate_per_km2 * 100
    );

    const reason = sold_out ? "no_remaining" : "ok";

    return json({
      ok: true,
      sold_out,
      available_km2: Math.max(0, remaining_km2),
      total_km2,
      rate_per_km2,
      price_cents,
      geojson,
      reason,
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
