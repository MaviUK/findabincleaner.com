import { createClient } from "@supabase/supabase-js";
import * as turf from "@turf/turf";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// Hard-blocking statuses per spec
const HARD_BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

// minutes to treat `incomplete` as a temporary hold
const HOLD_MINUTES = Number(process.env.INCOMPLETE_HOLD_MINUTES || 35);

function isBlockingRow(row) {
  const s = String(row?.status || "").toLowerCase();
  if (HARD_BLOCKING.has(s)) return true;
  if (s === "incomplete") {
    const ts = row?.created_at ? new Date(row.created_at).getTime() : 0;
    const ageMin = (Date.now() - ts) / 60000;
    return ageMin <= HOLD_MINUTES;
  }
  return false;
}

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
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const areaId = body?.areaId || body?.area_id;
  const slot = Number(body?.slot);
  const businessId = body?.businessId || body?.cleanerId || null;
  if (!areaId || !Number.isInteger(slot)) {
    return json({ ok: false, error: "Missing areaId or slot" }, 400);
  }

  try {
    // Area geometry
    const { data: areaRow, error: areaErr } = await sb
      .from("service_areas")
      .select("id, gj")
      .eq("id", areaId)
      .single();
    if (areaErr) throw areaErr;
    if (!areaRow?.gj) return json({ ok: false, error: "Area not found" }, 404);

    let base;
    const gj = areaRow.gj;
    if (gj.type === "Polygon") base = turf.multiPolygon([gj.coordinates]);
    else if (gj.type === "MultiPolygon") base = turf.multiPolygon(gj.coordinates);
    else return json({ ok: false, error: "Area geometry must be Polygon/MultiPolygon" }, 400);

    // Relevant subscriptions (area + slot), include created_at for time-box logic
    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("status, final_geojson, business_id, created_at")
      .eq("area_id", areaId)
      .eq("slot", slot);
    if (subsErr) throw subsErr;

    const blockers = (subs || []).filter(isBlockingRow);

    // Whole-slot block if any blocking row has no final geometry
    if (blockers.some((b) => !b.final_geojson)) {
      return json({
        ok: true,
        area_km2: 0,
        monthly_price: 0,
        final_geojson: null,
        previewId: null,
      });
    }

    // Subtract all blocking final geometries
    let available = base;
    for (const b of blockers) {
      const g = b.final_geojson;
      if (!g) continue;
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

    // Store a preview record (optional convenience; safe to fail)
    let previewId = null;
    try {
      const { data: inserted, error: insErr } = await sb
        .from("sponsored_previews")
        .insert([{
          area_id: areaId,
          slot,
          business_id: businessId,
          area_km2: km2,
          monthly_price: monthly,
          final_geojson: km2 > 0 ? available : null,
        }])
        .select("id")
        .single();
      if (insErr) throw insErr;
      previewId = inserted.id;
    } catch (e) {
      console.warn("preview insert failed (non-fatal):", e?.message || e);
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
