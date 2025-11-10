// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";
import * as turf from "@turf/turf";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

// JSON helper
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Blocking statuses (treat these as occupying the map)
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

const km2 = (m2) => (Number.isFinite(m2) ? m2 / 1_000_000 : 0);

// Normalize many possible geojson shapes to a MultiPolygon Feature
function toMultiPolygonFeature(geo) {
  if (!geo) return null;

  // Accept {type, coordinates} or Feature/FC wrappers
  let g = geo;
  if (g.type === "Feature") g = g.geometry;
  if (g.type === "FeatureCollection") {
    // union all polygonal features into a single multipolygon
    const polys = g.features
      .map((f) => (f.type === "Feature" ? f.geometry : f))
      .filter((gg) => gg && (gg.type === "Polygon" || gg.type === "MultiPolygon"));
    if (!polys.length) return null;
    let cur = turf.feature(polys[0]);
    for (let i = 1; i < polys.length; i++) {
      try {
        cur = turf.union(cur, turf.feature(polys[i])) || cur;
      } catch {
        // ignore bad union; keep going
      }
    }
    g = cur.geometry;
  }

  if (g.type === "Polygon") {
    return turf.multiPolygon([g.coordinates], {});
  }
  if (g.type === "MultiPolygon") {
    return turf.multiPolygon(g.coordinates, {});
  }
  return null;
}

// Union an array of polygonal features into a single multi polygon
function unionAll(features) {
  if (!features.length) return null;
  let cur = features[0];
  for (let i = 1; i < features.length; i++) {
    try {
      const u = turf.union(cur, features[i]);
      if (u) cur = u;
    } catch {
      // if union fails, fall back to simple collection (last one wins in difference)
      cur = features[i];
    }
  }
  return cur;
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const businessId = (body.businessId || body.cleanerId || "").trim();
  const areaId = (body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot ?? 1);

  if (!areaId || !/^[0-9a-f-]{36}$/i.test(areaId))
    return json({ ok: false, error: "Missing or invalid areaId" }, 400);
  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);
  if (slot !== 1) {
    // single-slot world; allow 1 only
    return json({ ok: false, error: "Invalid slot. Only slot=1 is supported." }, 400);
  }

  try {
    // 1) Load the target service area geometry
    const { data: sa, error: saErr } = await sb
      .from("service_areas")
      .select("id, gj")
      .eq("id", areaId)
      .maybeSingle();

    if (saErr || !sa?.gj) return json({ ok: false, error: "Area not found" }, 404);
    const target = toMultiPolygonFeature(sa.gj);
    if (!target) return json({ ok: false, error: "Invalid target geometry" }, 400);

    // Compute full area in km² (for UI info)
    let total_km2 = km2(turf.area(target));

    // 2) Fetch all *other* sponsored subscriptions (blocking) that could overlap
    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("id, business_id, area_id, status, final_geojson")
      .eq("slot", 1)
      .neq("business_id", businessId);

    if (subsErr) return json({ ok: false, error: subsErr.message || "Failed to load subscriptions" }, 500);

    // 3) Build list of blocking polygons from others
    const blockerFeatures = [];
    for (const s of subs || []) {
      const status = String(s.status || "").toLowerCase();
      if (!BLOCKING.has(status)) continue;

      let srcGeo = s.final_geojson;
      // Fallback to area gj if final_geojson missing
      if (!srcGeo) {
        const { data: a, error: aErr } = await sb
          .from("service_areas")
          .select("gj")
          .eq("id", s.area_id)
          .maybeSingle();
        if (aErr || !a?.gj) continue;
        srcGeo = a.gj;
      }

      const feat = toMultiPolygonFeature(srcGeo);
      if (feat) blockerFeatures.push(feat);
    }

    // 4) Union all blockers
    const blockersUnion = blockerFeatures.length ? unionAll(blockerFeatures) : null;

    // 5) Compute purchasable geometry = difference(target, blockersUnion)
    let purchGeom = null;
    if (!blockersUnion) {
      purchGeom = target;
    } else {
      try {
        purchGeom = turf.difference(target, blockersUnion) || null;
      } catch {
        // If difference fails, approximate with non-intersection check
        try {
          if (!turf.booleanIntersects(target, blockersUnion)) {
            purchGeom = target;
          } else {
            purchGeom = null;
          }
        } catch {
          purchGeom = null;
        }
      }
    }

    const area_km2 = purchGeom ? km2(turf.area(purchGeom)) : 0;

    // Currency/rates
    const currency = (process.env.RATE_CURRENCY || "GBP").toUpperCase();
    const unit_price =
      Number(process.env.RATE_PER_KM2_PER_MONTH ??
        process.env.RATE_GOLD_PER_KM2_PER_MONTH ??
        0);
    const min_monthly = Number(process.env.MIN_PRICE_PER_MONTH ??
      process.env.MIN_GOLD_PRICE_PER_MONTH ??
      0);

    // Prefer server-computed monthly if you have special logic; otherwise compute:
    const monthly_price = Math.max(min_monthly, unit_price * area_km2);

    // Availability flag (UI convenience)
    const available = area_km2 > 0;

    return json({
      ok: true,
      // geometry & areas
      geojson: purchGeom ? turf.featureCollection([purchGeom]) : null,
      area_km2,
      total_km2,
      // pricing
      unit_currency: currency,
      unit_price,              // major units
      min_monthly,             // major units
      monthly_price,           // major units
      // legacy pence fields for backward compat if you need them:
      unit_price_pence: Math.round(unit_price * 100),
      min_monthly_pence: Math.round(min_monthly * 100),
      monthly_price_pence: Math.round(monthly_price * 100),
      // helper
      available,
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
