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
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
new Response(JSON.stringify(body), {
@@ -41,98 +16,42 @@ export default async (req) => {
try {
body = await req.json();
} catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
    return json({ ok: false, error: "Invalid JSON body" }); // 200 with ok:false on client
}

  const areaId = body?.areaId || body?.area_id;
  const slot = Number(body?.slot);
  if (!areaId || !Number.isInteger(slot)) {
    return json({ ok: false, error: "Missing areaId or slot" }, 400);
  const areaId = (body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot);

  if (!areaId || !/^[0-9a-f-]{36}$/i.test(areaId)) {
    return json({ ok: false, error: "Missing or invalid areaId" });
  }
  if (![1, 2, 3].includes(slot)) {
    return json({ ok: false, error: "Missing or invalid slot (1..3)" });
}

try {
    // 1) Load the candidate area geometry
    const { data: areaRow, error: areaErr } = await sb
      .from("service_areas")
      .select("id, gj")
      .eq("id", areaId)
      .maybeSingle();
    if (areaErr) throw areaErr;
    if (!areaRow?.gj) return json({ ok: false, error: "Area not found" }, 404);

    let base;
    const gj = areaRow.gj;
    if (gj.type === "Polygon") base = turf.multiPolygon([gj.coordinates]);
    else if (gj.type === "MultiPolygon") base = turf.multiPolygon(gj.coordinates);
    else return json({ ok: false, error: "Area geometry must be Polygon/MultiPolygon" }, 400);

    // 2) Fetch ALL blocking subs (across ALL areas) for this slot
    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, final_geojson");
    if (subsErr) throw subsErr;

    const blockersRaw = (subs || []).filter((s) => s.slot === slot && BLOCKING.has(s.status));
    // Call a tiny SQL helper that reads from v_area_slot_remaining and returns km2 + geojson
    const { data, error } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });

    // 3) Load missing area geometries for blockers that lack final_geojson
    const needAreaIds = Array.from(
      new Set(blockersRaw.filter((s) => !s.final_geojson && s.area_id).map((s) => s.area_id))
    );
    let extraAreas = [];
    if (needAreaIds.length) {
      const { data: more, error: moreErr } = await sb
        .from("service_areas")
        .select("id, gj")
        .in("id", needAreaIds);
      if (moreErr) throw moreErr;
      extraAreas = more || [];
    if (error) {
      return json({ ok: false, error: error.message || "Preview query failed" });
}
    const areaGeomById = new Map(extraAreas.map((a) => [a.id, a.gj]));

    // 4) Turn blockers into turf geometries and subtract them from base if they overlap
    let available = base;
    for (const b of blockersRaw) {
      let g = b.final_geojson;
      if (!g && b.area_id && areaGeomById.has(b.area_id)) {
        g = areaGeomById.get(b.area_id);
      }
      if (!g) continue;

      let blockGeom = null;
      if (g.type === "Polygon") blockGeom = turf.multiPolygon([g.coordinates]);
      else if (g.type === "MultiPolygon") blockGeom = turf.multiPolygon(g.coordinates);

      if (!blockGeom) continue;

      // Skip quick if disjoint
      if (turf.booleanDisjoint(available, blockGeom)) continue;

      try {
        const diff = turf.difference(available, blockGeom);
        available = diff || turf.multiPolygon([]);
      } catch (e) {
        console.error("GEOM(difference) error:", e);
        return json({ ok: false, error: "Geometry operation failed" }, 400);
      }
    }
    // If no row, treat as zero/none rather than throwing
    const row = Array.isArray(data) ? data[0] : data;

    // 5) Price the remaining area
    const m2 = turf.area(available);
    const km2 = m2 / 1e6;
    const rate = rateForSlot(slot);
    const min = minForSlot(slot);
    const monthly = km2 > 0 ? Math.max(km2 * rate, min) : 0;
    const area_km2 = Number(row?.area_km2 ?? 0);
    const geojson = row?.gj ?? null;

    // You can optionally mint a short-lived preview id/url here if you want
return json({
ok: true,
      area_km2: Number(km2.toFixed(6)),
      monthly_price: Math.round(monthly * 100) / 100,
      final_geojson: km2 > 0 ? available : null,
      // preview_url: "...optional..."
      area_km2,
      geojson, // this is a GeoJSON geometry or null
});
} catch (e) {
    console.error("UNEXPECTED:", e);
    return json({ ok: false, error: "Unexpected server error" }, 500);
    return json({ ok: false, error: e?.message || "Server error" });
}
};
