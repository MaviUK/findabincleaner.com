// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";
import area from "@turf/area";
import intersect from "@turf/intersect";
import difference from "@turf/difference";
import union from "@turf/union";
import { multiPolygon, polygon, featureCollection } from "@turf/helpers";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// statuses that should block new purchases
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

function toFeature(geo) {
  // Accept Polygon/MultiPolygon/Feature
  if (!geo) return null;
  if (geo.type === "Feature") return geo;
  if (geo.type === "Polygon" || geo.type === "MultiPolygon") return { type: "Feature", geometry: geo, properties: {} };
  return null;
}

// Safe union of many features
function unionMany(features) {
  if (!features.length) return null;
  let acc = features[0];
  for (let i = 1; i < features.length; i++) {
    try {
      acc = union(acc, features[i]) || acc;
    } catch {
      // If union fails on a nasty geometry, just skip that piece to keep flow resilient
    }
  }
  return acc;
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const cleanerId = String(body.cleanerId || body.businessId || "").trim();
  const areaId = String(body.areaId || body.area_id || "").trim();
  const slot = 1; // single Featured slot only

  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);

  try {
    // 1) Get target service area geometry
    const { data: target, error: tErr } = await sb
      .from("service_areas")
      .select("gj")
      .eq("id", areaId)
      .maybeSingle();
    if (tErr || !target?.gj) return json({ ok: false, error: "Area not found" }, 404);

    const targetF = toFeature(target.gj);
    if (!targetF) return json({ ok: false, error: "Invalid area geometry" }, 400);

    // 2) Collect ALL active Featured sponsorships by OTHER businesses
    const { data: taken, error: sErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id, area_id, status, slot, area:service_areas(gj)")
      .eq("slot", slot);
    if (sErr) return json({ ok: false, error: sErr.message || "Failed to query sponsorships" }, 500);

    const activeOthers = (taken || []).filter(
      (r) =>
        r?.area?.gj &&
        r.business_id &&
        r.business_id !== cleanerId &&
        BLOCKING.has(String(r.status || "").toLowerCase())
    );

    // 3) Build union of overlapping (other) geometries clipped to our target area
    const overlaps = [];
    for (const r of activeOthers) {
      const otherF = toFeature(r.area.gj);
      if (!otherF) continue;

      try {
        const ov = intersect(otherF, targetF);
        if (ov) overlaps.push(ov);
      } catch {
        // bad geometry can throw — ignore and continue
      }
    }
    const occupied = overlaps.length ? unionMany(overlaps) : null;

    // 4) Remaining purchasable sub-region = target - occupied
    let remaining = null;
    if (!occupied) {
      remaining = targetF;
    } else {
      try {
        remaining = difference(targetF, occupied) || null;
      } catch {
        // If difference fails, fallback to "no remaining"
        remaining = null;
      }
    }

    // 5) Compute areas (km²)
    const total_m2 = (() => {
      try {
        return area(targetF);
      } catch {
        return null;
      }
    })();
    const total_km2 = total_m2 != null ? total_m2 / 1_000_000 : null;

    const remaining_m2 = remaining ? area(remaining) : 0;
    const area_km2 = remaining ? remaining_m2 / 1_000_000 : 0;

    // 6) Pricing hints (env-backed; optional)
    const rate_per_km2 =
      Number(process.env.RATE_PER_KM2_PER_MONTH) ||
      Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH) ||
      1;
    const min_monthly = Number(process.env.MIN_PRICE_PER_MONTH) || Number(process.env.MIN_GOLD_PRICE_PER_MONTH) || 1;
    const unit_currency = "GBP";
    const monthly_price = Math.max(min_monthly, (area_km2 || 0) * rate_per_km2);

    return json({
      ok: true,
      geojson: remaining ? remaining.geometry || remaining : null,
      area_km2: Math.max(0, Number(area_km2 || 0)),
      total_km2: total_km2 != null ? Math.max(0, Number(total_km2)) : null,
      rate_per_km2,
      min_monthly,
      monthly_price,
      unit_currency,
    });
  } catch (e) {
    console.error("sponsored-preview fatal:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
