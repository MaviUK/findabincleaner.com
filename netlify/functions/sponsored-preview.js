process.env.SUPABASE_SERVICE_ROLE
);

// These statuses block a slot
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

// pricing helpers
function rateForSlot(slot) {
const base = Number(process.env.RATE_PER_KM2_PER_MONTH || 1);
const perSlot = {
@@ -36,45 +34,8 @@ const json = (body, status = 200) =>
headers: { "content-type": "application/json" },
});

// ---- geometry helpers (resilient) ----
function toMulti(g) {
  if (!g) return null;
  if (g.type === "Polygon") return turf.multiPolygon([g.coordinates]);
  if (g.type === "MultiPolygon") return turf.multiPolygon(g.coordinates);
  return null;
}
function sanitize(mp) {
  try {
    mp = turf.cleanCoords(mp);
  } catch {}
  try {
    // Ensure winding order for valid ops
    mp = turf.rewind(mp, { reverse: false });
  } catch {}
  return mp;
}
function safeDiff(a, b) {
  try {
    const d = turf.difference(a, b);
    return d ? d : turf.multiPolygon([]);
  } catch (e) {
    // If topology is too gnarly, be conservative: no purchasable area
    return turf.multiPolygon([]);
  }
}
function areaKm2(geom) {
  try {
    const m2 = turf.area(geom);
    return m2 / 1e6;
  } catch {
    return 0;
  }
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

let body;
try {
@@ -89,78 +50,89 @@ export default async (req) => {
return json({ ok: false, error: "Missing areaId or slot" }, 400);
}

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
    return json({ ok: false, error: "Server misconfigured: missing Supabase env" }, 500);
  }

try {
    // 1) Load base area geometry
    // 1) Load the candidate area geometry
const { data: areaRow, error: areaErr } = await sb
.from("service_areas")
.select("id, gj")
.eq("id", areaId)
.maybeSingle();

if (areaErr) throw areaErr;
if (!areaRow?.gj) return json({ ok: false, error: "Area not found" }, 404);

    let base = toMulti(areaRow.gj);
    if (!base) return json({ ok: false, error: "Area geometry must be Polygon/MultiPolygon" }, 400);
    base = sanitize(base);
    let base;
    const gj = areaRow.gj;
    if (gj.type === "Polygon") base = turf.multiPolygon([gj.coordinates]);
    else if (gj.type === "MultiPolygon") base = turf.multiPolygon(gj.coordinates);
    else return json({ ok: false, error: "Area geometry must be Polygon/MultiPolygon" }, 400);

    // 2) Find blocking subscriptions in this slot
    // 2) Fetch ALL blocking subs (across ALL areas) for this slot
const { data: subs, error: subsErr } = await sb
.from("sponsored_subscriptions")
      .select("status, final_geojson")
      .eq("area_id", areaId)
      .eq("slot", slot);

      .select("area_id, slot, status, final_geojson");
if (subsErr) throw subsErr;

    const blockers = (subs || []).filter((s) => BLOCKING.has(s.status));

    // If any blocker has null final_geojson => whole slot is blocked
    if (blockers.some((b) => !b.final_geojson)) {
      return json({
        ok: true,
        area_km2: 0,
        monthly_price: 0,
        final_geojson: null,
      });
    const blockersRaw = (subs || []).filter((s) => s.slot === slot && BLOCKING.has(s.status));

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
}
    const areaGeomById = new Map(extraAreas.map((a) => [a.id, a.gj]));

    // 3) Subtract blockers (robustly)
    // 4) Turn blockers into turf geometries and subtract them from base if they overlap
let available = base;
    for (const b of blockers) {
      const bg = sanitize(toMulti(b.final_geojson));
      if (!bg) continue;
      available = safeDiff(available, bg);
    }

    // 4) Compute price
    const km2 = areaKm2(available);
    if (!(km2 > 0)) {
      return json({
        ok: true,
        area_km2: 0,
        monthly_price: 0,
        final_geojson: null,
      });
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

    // 5) Price the remaining area
    const m2 = turf.area(available);
    const km2 = m2 / 1e6;
const rate = rateForSlot(slot);
const min = minForSlot(slot);
    const monthly = Math.max(km2 * rate, min);
    const monthly = km2 > 0 ? Math.max(km2 * rate, min) : 0;

    // You can optionally mint a short-lived preview id/url here if you want
return json({
ok: true,
area_km2: Number(km2.toFixed(6)),
monthly_price: Math.round(monthly * 100) / 100,
      final_geojson: available, // MultiPolygon of purchasable sub-region
      final_geojson: km2 > 0 ? available : null,
      // preview_url: "...optional..."
});
} catch (e) {
    console.error("sponsored-preview unexpected error:", e);
    // Be conservative: do NOT allow purchase if we can't compute safely
    return json({ ok: true, area_km2: 0, monthly_price: 0, final_geojson: null });
    console.error("UNEXPECTED:", e);
    return json({ ok: false, error: "Unexpected server error" }, 500);
}
};
