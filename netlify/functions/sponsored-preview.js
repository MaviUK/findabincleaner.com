// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";
import * as turf from "@turf/turf";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

function rateForSlot(slot) {
  const base = Number(process.env.RATE_PER_KM2_PER_MONTH || 1);
  const perSlot = {
    1: Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH || base),
    2: Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH || base),
    3: Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH || base),
  };
  return perSlot[slot] || base;
}
function minForSlot(slot) {
  const base = Number(process.env.MIN_PRICE_PER_MONTH || 1);
  const perSlot = {
    1: Number(process.env.MIN_GOLD_PRICE_PER_MONTH || base),
    2: Number(process.env.MIN_SILVER_PRICE_PER_MONTH || base),
    3: Number(process.env.MIN_BRONZE_PRICE_PER_MONTH || base),
  };
  return perSlot[slot] || base;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async (req) => {
  if (req.method !== "POST")
    return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const areaId = body?.areaId;
  const slot = Number(body?.slot);
  const businessId = body?.businessId || null;
  if (!areaId || !Number.isInteger(slot)) {
    return json({ ok: false, error: "Missing areaId or slot" }, 400);
  }

  try {
    const { data: areaRow, error: areaErr } = await sb
      .from("service_areas")
      .select("id, gj")
      .eq("id", areaId)
      .single();

    if (areaErr) throw areaErr;
    if (!areaRow?.gj)
      return json({ ok: false, error: "Area not found" }, 404);

    let base;
    const gj = areaRow.gj;
    if (gj.type === "Polygon") base = turf.multiPolygon([gj.coordinates]);
    else if (gj.type === "MultiPolygon") base = turf.multiPolygon(gj.coordinates);
    else return json({ ok: false, error: "Invalid area geometry" }, 400);

    // Validate geometry
    try {
      const k = turf.kinks(base);
      if (k?.features?.length) {
        return json({ ok: false, error: "Area geometry is self-intersecting" }, 400);
      }
    } catch (_) {}

    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("status, final_geojson")
      .eq("area_id", areaId)
      .eq("slot", slot);

    if (subsErr) throw subsErr;

    const blockers = (subs || []).filter((s) => BLOCKING.has(s.status));
    if (blockers.some((b) => !b.final_geojson)) {
      return json({
        ok: true,
        area_km2: 0,
        monthly_price: 0,
        final_geojson: null,
      });
    }

    let available = base;
    for (const b of blockers) {
      if (!b.final_geojson) continue;
      const g = b.final_geojson;
      let blockGeom;
      if (g.type === "Polygon") blockGeom = turf.multiPolygon([g.coordinates]);
      else if (g.type === "MultiPolygon") blockGeom = turf.multiPolygon(g.coordinates);
      else continue;

      try {
        available = turf.difference(available, blockGeom) || turf.multiPolygon([]);
      } catch (e) {
        console.error("GEOM(difference) error:", e);
        return json({ ok: false, error: "Geometry difference failed" }, 400);
      }
    }

    const m2 = turf.area(available);
    const km2 = m2 / 1e6;
    const rate = rateForSlot(slot);
    const min = minForSlot(slot);
    const monthly = km2 > 0 ? Math.max(km2 * rate, min) : 0;

    // --- store preview for checkout validation
    let previewId = null;
    try {
      const { data: inserted, error: insertErr } = await sb
        .from("sponsored_previews")
        .insert([
          {
            area_id: areaId,
            slot,
            business_id: businessId,
            area_km2: km2,
            monthly_price: monthly,
            final_geojson: km2 > 0 ? available : null,
          },
        ])
        .select("id")
        .single();
      if (insertErr) throw insertErr;
      previewId = inserted.id;
    } catch (e) {
      console.error("Insert preview failed:", e);
    }

    return json({
      ok: true,
      area_km2: Number(km2.toFixed(6)),
      monthly_price: Math.round(monthly * 100) / 100,
      final_geojson: km2 > 0 ? available : null,
      previewId,
    });
  } catch (e) {
    console.error("UNEXPECTED:", e);
    return json({ ok: false, error: "Unexpected server error" }, 500);
  }
};
