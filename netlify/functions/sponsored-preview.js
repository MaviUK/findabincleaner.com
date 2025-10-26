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
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const areaId = body?.areaId;
  const slot = Number(body?.slot);
  if (!areaId || !Number.isInteger(slot)) {
    return json({ ok: false, error: "Missing areaId or slot" }, 400);
  }

  // Quick sanity on env (don’t log secrets)
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
    return json({ ok: false, error: "Server misconfigured: missing Supabase env" }, 500);
  }

  try {
    // ---- DB reads
    let areaRow, areaErr;
    try {
      const { data, error } = await sb
        .from("service_areas")
        .select("id, gj")
        .eq("id", areaId)
        .limit(1)
        .single();
      areaRow = data;
      areaErr = error;
    } catch (e) {
      areaErr = e;
    }
    if (areaErr) {
      console.error("DB(area) error:", areaErr);
      return json({ ok: false, error: "DB(area) error" }, 500);
    }
    if (!areaRow?.gj) return json({ ok: false, error: "Area not found" }, 404);

    let base;
    const gj = areaRow.gj;
    if (gj.type === "Polygon") base = turf.multiPolygon([gj.coordinates]);
    else if (gj.type === "MultiPolygon") base = turf.multiPolygon(gj.coordinates);
    else return json({ ok: false, error: "Area geometry must be Polygon/MultiPolygon" }, 400);

    // Detect invalid/self-intersecting geometry early
    try {
      const k = turf.kinks(base);
      if (k && k.features && k.features.length > 0) {
        return json({ ok: false, error: "Area geometry is self-intersecting" }, 400);
      }
    } catch (_) {
      // ignore kinks errors
    }

    let subs, subsErr;
    try {
      const { data, error } = await sb
        .from("sponsored_subscriptions")
        .select("status, final_geojson")
        .eq("area_id", areaId)
        .eq("slot", slot);
      subs = data || [];
      subsErr = error;
    } catch (e) {
      subsErr = e;
    }
    if (subsErr) {
      console.error("DB(subs) error:", subsErr);
      return json({ ok: false, error: "DB(subscriptions) error" }, 500);
    }

    const blockers = subs.filter((s) => BLOCKING.has(s.status));
    if (blockers.some((b) => !b.final_geojson)) {
      return json({ ok: true, area_km2: 0, monthly_price: 0, final_geojson: null });
    }

    // ---- Geometry ops
    let available = base;
    for (const b of blockers) {
      const g = b.final_geojson;
      if (!g) continue;
      let blockGeom;
      if (g.type === "Polygon") blockGeom = turf.multiPolygon([g.coordinates]);
      else if (g.type === "MultiPolygon") blockGeom = turf.multiPolygon(g.coordinates);
      else continue;

      // difference can throw on bad rings — guard it
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

    return json({
      ok: true,
      area_km2: Number(km2.toFixed(6)),
      monthly_price: Math.round(monthly * 100) / 100,
      final_geojson: km2 > 0 ? available : null,
    });
  } catch (e) {
    console.error("UNEXPECTED:", e);
    return json({ ok: false, error: "Unexpected server error" }, 500);
  }
};
