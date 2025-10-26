// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";
import * as turf from "@turf/turf";

/**
 * ENV expected:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE
 * - RATE_GOLD_PER_KM2_PER_MONTH (number, optional)
 * - RATE_SILVER_PER_KM2_PER_MONTH (number, optional)
 * - RATE_BRONZE_PER_KM2_PER_MONTH (number, optional)
 * - MIN_GOLD_PRICE_PER_MONTH (number, optional)
 * - MIN_SILVER_PRICE_PER_MONTH (number, optional)
 * - MIN_BRONZE_PRICE_PER_MONTH (number, optional)
 */
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const ACTIVE_BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

/** Helpers */
function asMultiPolygon(geo) {
  if (!geo) return null;

  // FeatureCollection -> recurse
  if (geo.type === "FeatureCollection" && Array.isArray(geo.features)) {
    const polys = geo.features.map(asMultiPolygon).filter(Boolean);
    if (!polys.length) return null;
    // union all features into a single MultiPolygon
    let acc = polys[0];
    for (let i = 1; i < polys.length; i++) {
      acc = unionSafe(acc, polys[i]);
    }
    return acc;
  }

  // Feature -> recurse geometry
  if (geo.type === "Feature" && geo.geometry) {
    return asMultiPolygon(geo.geometry);
  }

  if (geo.type === "Polygon") {
    return turf.multiPolygon([geo.coordinates]);
  }
  if (geo.type === "MultiPolygon") {
    return turf.multiPolygon(geo.coordinates);
  }

  // some projects store under .gj or .geojson
  if (geo.gj) return asMultiPolygon(geo.gj);
  if (geo.geojson) return asMultiPolygon(geo.geojson);
  if (geo.geometry) return asMultiPolygon(geo.geometry);

  return null;
}

function unionSafe(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  try {
    const u = turf.union(a, b);
    // turf.union may return Polygon; normalize to MultiPolygon
    return asMultiPolygon(u);
  } catch {
    // fallback: dissolve by buffering 0
    try {
      const u = turf.buffer(turf.union(turf.buffer(a, 0), turf.buffer(b, 0)), 0);
      return asMultiPolygon(u);
    } catch {
      return a;
    }
  }
}

function differenceSafe(a, b) {
  if (!a) return null;
  if (!b) return a;
  try {
    const d = turf.difference(a, b);
    return asMultiPolygon(d);
  } catch {
    // robust fallback with tiny buffer to fix ring/winding issues
    try {
      const d = turf.difference(turf.buffer(a, 0), turf.buffer(b, 0));
      return asMultiPolygon(d);
    } catch {
      return a; // if difference fails, be safe & return original (won’t underbill)
    }
  }
}

function km2FromArea(feature) {
  if (!feature) return 0;
  try {
    const m2 = turf.area(feature);
    return m2 / 1_000_000;
  } catch {
    return 0;
  }
}

function priceFor(slot, km2) {
  const s = Number(slot);
  const rates = {
    1: Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0),
    2: Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0),
    3: Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0),
  };
  const mins = {
    1: Number(process.env.MIN_GOLD_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 0),
    2: Number(process.env.MIN_SILVER_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 0),
    3: Number(process.env.MIN_BRONZE_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 0),
  };

  const rate = rates[s] ?? 0;
  const min = mins[s] ?? 0;

  const raw = rate * km2;
  // round to 2dp, apply minimum (but only if > 0 area)
  const rounded = Math.round(raw * 100) / 100;
  if (km2 <= 0) return 0;
  return Math.max(rounded, min);
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const businessId = body?.businessId || body?.cleanerId;
  const areaId = body?.areaId || body?.area_id;
  const slot = Number(body?.slot);

  if (!businessId || !areaId || !slot) {
    return json({ ok: false, error: "businessId/cleanerId, areaId, and slot are required" }, 400);
  }

  try {
    // 1) Fetch the service area geometry
    const { data: areaRow, error: areaErr } = await sb
      .from("service_areas")
      .select("id, gj")
      .eq("id", areaId)
      .single();

    if (areaErr || !areaRow?.gj) {
      return json({ ok: false, error: "Area not found" }, 404);
    }

    let areaGeom = asMultiPolygon(areaRow.gj);
    if (!areaGeom) {
      return json({ ok: false, error: "Invalid area geometry" }, 422);
    }

    // 2) Collect blockers: other businesses with ACTIVE status on the SAME slot
    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("id, business_id, status, slot, final_geojson")
      .eq("area_id", areaId)
      .eq("slot", slot) // ← only the selected slot blocks
      .neq("business_id", businessId);

    if (subsErr) {
      console.error("[sponsored-preview] subsErr:", subsErr);
      return json({ ok: false, error: "DB error" }, 500);
    }

    // union all blocking footprints for this slot
    let takenUnion = null;
    for (const row of subs || []) {
      if (!ACTIVE_BLOCKING.has(row.status)) continue; // ignore non-active-ish states
      const g = asMultiPolygon(row.final_geojson);
      if (!g) continue;
      takenUnion = unionSafe(takenUnion, g);
    }

    // 3) Compute remaining purchasable region for this slot
    const available = differenceSafe(areaGeom, takenUnion);
    const km2 = km2FromArea(available);
    const monthly = priceFor(slot, km2);

    // If nothing left, return ok with 0s (UI shows guidance)
    if (!available || km2 <= 0) {
      return json({
        ok: true,
        area_km2: 0,
        monthly_price: 0,
        final_geojson: null,
      });
    }

    // Normalize to plain GeoJSON MultiPolygon for the frontend
    const final_geojson = turf.getGeom(available); // MultiPolygon geometry (not Feature)

    return json({
      ok: true,
      area_km2: Number(km2.toFixed(6)),
      monthly_price: Number(monthly.toFixed(2)),
      final_geojson,
    });
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    return json({ ok: false, error: "Preview failed" }, 500);
  }
};
