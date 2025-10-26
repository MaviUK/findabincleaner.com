// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";
import * as turf from "@turf/turf";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const ACTIVE_BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

/* ---------------- helpers ---------------- */
function asMultiPolygon(geo) {
  if (!geo) return null;
  if (geo.type === "FeatureCollection" && Array.isArray(geo.features)) {
    const parts = geo.features.map(asMultiPolygon).filter(Boolean);
    if (!parts.length) return null;
    return parts.reduce((acc, g) => unionSafe(acc, g), null);
  }
  if (geo.type === "Feature" && geo.geometry) return asMultiPolygon(geo.geometry);
  if (geo.type === "Polygon") return turf.multiPolygon(geo.coordinates);
  if (geo.type === "MultiPolygon") return turf.multiPolygon(geo.coordinates);
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
    return asMultiPolygon(u);
  } catch {
    try {
      const u = turf.union(turf.buffer(a, 0), turf.buffer(b, 0));
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
    try {
      const d = turf.difference(turf.buffer(a, 0), turf.buffer(b, 0));
      return asMultiPolygon(d);
    } catch {
      return a; // safest fallback (don’t under-bill)
    }
  }
}
function km2FromArea(feature) {
  if (!feature) return 0;
  try {
    return turf.area(feature) / 1_000_000;
  } catch {
    return 0;
  }
}
function priceFor(slot, km2) {
  const s = Number(slot);
  const rate =
    s === 1
      ? Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0)
      : s === 2
      ? Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0)
      : Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0);

  const min =
    s === 1
      ? Number(process.env.MIN_GOLD_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 0)
      : s === 2
      ? Number(process.env.MIN_SILVER_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 0)
      : Number(process.env.MIN_BRONZE_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 0);

  if (km2 <= 0) return 0;
  const raw = Math.round(rate * km2 * 100) / 100;
  return Math.max(raw, min);
}

/* --------------- handler ------------------ */
export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const businessId = body?.businessId || body?.cleanerId;
  const areaId = body?.areaId || body?.area_id;
  const slot = Number(body?.slot);

  if (!businessId || !areaId || !slot) {
    return json({ ok: false, error: "businessId/cleanerId, areaId, and slot are required" }, 400);
  }

  try {
    // 1) Load area geometry
    const { data: areaRow, error: areaErr } = await sb
      .from("service_areas")
      .select("id, gj")
      .eq("id", areaId)
      .single();

    if (areaErr) {
      console.error("[sponsored-preview] areaErr:", areaErr);
      return json({ ok: false, error: "DB error (area)" }, 500);
    }
    if (!areaRow?.gj) return json({ ok: false, error: "Area not found" }, 404);

    const areaGeom = asMultiPolygon(areaRow.gj);
    if (!areaGeom) return json({ ok: false, error: "Invalid area geometry" }, 422);

    // 2) Load subscriptions for the SAME slot, not mine
    let subs;
    let subsErr;

    // Try with common footprint column names
    const footprintSelects = [
      "id,business_id,status,slot,final_geojson",
      "id,business_id,status,slot,geo_footprint",
      "id,business_id,status,slot", // fallback: no footprint column in schema
    ];

    for (const sel of footprintSelects) {
      const out = await sb
        .from("sponsored_subscriptions")
        .select(sel)
        .eq("area_id", areaId)
        .eq("slot", slot)
        .neq("business_id", businessId);

      if (out.error) {
        // column doesn’t exist? try next projection
        console.warn("[sponsored-preview] subscriptions select failed with:", sel, out.error);
        subsErr = out.error;
        continue;
      }
      subs = out.data || [];
      subsErr = null;
      break;
    }

    if (subsErr) {
      console.error("[sponsored-preview] subsErr:", subsErr);
      return json({ ok: false, error: "DB error" }, 500);
    }

    // 3) Build blockers union
    let takenUnion = null;
    let anyActiveWithoutFootprint = false;

    for (const row of subs) {
      if (!ACTIVE_BLOCKING.has(row.status)) continue;

      // detect possible footprint fields
      const footprint = row.final_geojson ?? row.geo_footprint ?? null;
      const g = asMultiPolygon(footprint);

      if (g) {
        takenUnion = unionSafe(takenUnion, g);
      } else {
        // if schema has no per-subscription geometry, treat as full-area blocker (conservative)
        anyActiveWithoutFootprint = true;
      }
    }

    if (anyActiveWithoutFootprint) {
      // any active same-slot record without a footprint means slot is fully blocked
      takenUnion = unionSafe(takenUnion, areaGeom);
    }

    // 4) Compute available sub-region
    const available = differenceSafe(areaGeom, takenUnion);
    const km2 = km2FromArea(available);
    const monthly = priceFor(slot, km2);

    if (!available || km2 <= 0) {
      return json({ ok: true, area_km2: 0, monthly_price: 0, final_geojson: null });
    }

    const final_geojson = turf.getGeom(available); // MultiPolygon
    return json({
      ok: true,
      area_km2: Number(km2.toFixed(6)),
      monthly_price: Number(monthly.toFixed(2)),
      final_geojson,
    });
  } catch (e) {
    console.error("[sponsored-preview] fatal:", e);
    return json({ ok: false, error: "Preview failed" }, 500);
  }
};
