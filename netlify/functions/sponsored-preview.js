import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// statuses that block the slot
const BLOCKING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const areaId = (body.areaId || "").trim();
  const businessId = (body.businessId || body.cleanerId || "").trim();
  const slot = Number(body.slot || 1);
  if (!areaId || !businessId) return json({ ok: false, error: "Missing params" }, 400);
  if (slot !== 1) return json({ ok: false, error: "Invalid slot" }, 400); // single featured slot

  try {
    // 1) HARD OWNERSHIP CHECK: block if ANY blocking row exists by another business
    const { data: blockers, error: blkErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id, status")
      .eq("area_id", areaId)
      .eq("slot", slot);

    if (blkErr) return json({ ok: false, error: blkErr.message || "Ownership check failed" }, 500);

    const blocker = (blockers || []).find(
      (r) => BLOCKING.has(String(r.status || "").toLowerCase()) && r.business_id !== businessId
    );
    const ownedByOther = Boolean(blocker);

    // 2) Get remaining purchasable area (km²) from your Postgres RPC
    const { data: prevData, error: prevErr } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });
    if (prevErr) return json({ ok: false, error: prevErr.message || "Preview failed" }, 500);

    const row0 = Array.isArray(prevData) ? prevData[0] : prevData || {};
    const available_km2 = Number(row0?.area_km2 ?? 0);
    const previewGeo = row0?.gj ?? null;

    // 3) Compute *total* area with PostGIS too (consistent with available)
    //    Create this SQL function once in your DB:
    //    create or replace function area_total_km2(p_area_id uuid)
    //    returns numeric language sql stable as $$
    //      select coalesce(
    //        ST_Area( ST_SetSRID(ST_GeomFromGeoJSON(sa.gj::json),4326)::geography )/1000000.0, 0)
    //      from service_areas sa where sa.id = p_area_id;
    //    $$;
    const { data: totalReply, error: totalErr } = await sb.rpc("area_total_km2", {
      p_area_id: areaId,
    });
    if (totalErr) return json({ ok: false, error: totalErr.message || "Total area failed" }, 500);
    const total_km2 = Number(totalReply ?? 0);

    // 4) rates
    const rate_per_km2 =
      Number(process.env.RATE_PER_KM2_PER_MONTH) ||
      Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH) ||
      1;
    const floor_monthly =
      Number(process.env.MIN_PRICE_PER_MONTH) ||
      Number(process.env.MIN_GOLD_PRICE_PER_MONTH) ||
      1;

    // Clamp available to not exceed total (just in case of rounding noise)
    const availClamped =
      Number.isFinite(available_km2) && Number.isFinite(total_km2)
        ? Math.min(available_km2, total_km2)
        : available_km2;

    if (ownedByOther) {
      return json({
        ok: true,
        sold_out: true,
        sold_to_business_id: blocker?.business_id || null,
        area_km2: 0,
        total_km2,
        rate_per_km2,
        floor_monthly,
        unit_currency: "GBP",
        geojson: null,
      });
    }

    return json({
      ok: true,
      sold_out: false,
      sold_to_business_id: null,
      area_km2: Number.isFinite(availClamped) ? availClamped : 0,
      total_km2,
      rate_per_km2,
      floor_monthly,
      unit_currency: "GBP",
      geojson: previewGeo || null,
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
