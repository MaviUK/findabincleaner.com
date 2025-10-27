// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";
import * as turf from "@turf/turf";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

const SLOT_COLORS = {
  1: "#f59e0b", // gold
  2: "#9ca3af", // silver
  3: "#cd7f32", // bronze
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * For each requested areaId, return whether each slot (1/2/3) is taken.
 * "Taken" means: there exists a BLOCKING subscription in that slot whose
 * geometry (final_geojson if present, otherwise the subscription's area.gj)
 * INTERSECTS this area's geometry by more than 0 area.
 *
 * This lets different area_ids still block each other when they overlap.
 */
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const areaIds = Array.isArray(body?.areaIds) ? body.areaIds.filter(Boolean) : [];
  if (!areaIds.length) return json({ areas: [] });

  try {
    // 1) Load geometries for the requested areas
    const { data: areas, error: areasErr } = await sb
      .from("service_areas")
      .select("id, business_id, gj")
      .in("id", areaIds);

    if (areasErr) throw areasErr;

    // Pre-build turf multipolygons for these areas
    const areaById = {};
    for (const a of areas || []) {
      if (!a?.gj) continue;
      let baseMulti;
      if (a.gj.type === "Polygon") baseMulti = turf.multiPolygon([a.gj.coordinates]);
      else if (a.gj.type === "MultiPolygon") baseMulti = turf.multiPolygon(a.gj.coordinates);
      else continue;

      areaById[a.id] = {
        id: a.id,
        business_id: a.business_id,
        turf: baseMulti,
      };
    }

    // 2) Fetch ALL blocking subscriptions (across ALL areas), only with needed columns
    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id, final_geojson");

    if (subsErr) throw subsErr;

    const blockersRaw = (subs || []).filter((s) => BLOCKING.has(s.status));

    // 3) We also need geometry for areas referenced by blockers that have no final_geojson
    const missingGeomAreaIds = Array.from(
      new Set(
        blockersRaw
          .filter((s) => !s.final_geojson && s.area_id)
          .map((s) => s.area_id)
      )
    ).filter((id) => !areaById[id]); // we may already have it if requested

    if (missingGeomAreaIds.length) {
      const { data: moreAreas, error: moreAreasErr } = await sb
        .from("service_areas")
        .select("id, gj")
        .in("id", missingGeomAreaIds);

      if (moreAreasErr) throw moreAreasErr;

      for (const a of moreAreas || []) {
        if (!a?.gj) continue;
        let mp;
        if (a.gj.type === "Polygon") mp = turf.multiPolygon([a.gj.coordinates]);
        else if (a.gj.type === "MultiPolygon") mp = turf.multiPolygon(a.gj.coordinates);
        else continue;
        // store only the turf geom; business_id not needed for blockers' foreign areas
        areaById[a.id] = { id: a.id, turf: mp };
      }
    }

    // 4) Build blocker geometries as turf multipolygons
    const blockers = [];
    for (const s of blockersRaw) {
      let geom = null;
      if (s.final_geojson) {
        const g = s.final_geojson;
        if (g.type === "Polygon") geom = turf.multiPolygon([g.coordinates]);
        else if (g.type === "MultiPolygon") geom = turf.multiPolygon(g.coordinates);
      } else if (s.area_id && areaById[s.area_id]?.turf) {
        // treat whole area as the blocking geometry
        geom = areaById[s.area_id].turf;
      }
      if (!geom) continue;

      blockers.push({
        slot: s.slot,
        business_id: s.business_id,
        geom,
      });
    }

    // 5) For each requested area, mark slots as taken if ANY blocker intersects it
    const results = [];
    for (const requested of areas || []) {
      const pack = {
        area_id: requested.id,
        slots: {
          1: { slot: 1, taken: false, status: null, owner_business_id: null, paint: SLOT_COLORS[1] },
          2: { slot: 2, taken: false, status: null, owner_business_id: null, paint: SLOT_COLORS[2] },
          3: { slot: 3, taken: false, status: null, owner_business_id: null, paint: SLOT_COLORS[3] },
        },
      };

      const thisTurf = areaById[requested.id]?.turf;
      if (!thisTurf) {
        results.push(pack);
        continue;
      }

      for (const b of blockers) {
        // Quick bbox check to skip obvious non-overlaps
        if (!turf.booleanDisjoint(thisTurf, b.geom)) {
          // Compute intersection area to avoid tiny boundary touches
          let inter = null;
          try {
            inter = turf.intersect(thisTurf, b.geom);
          } catch (_) {}
          const area = inter ? turf.area(inter) : 0;
          if (area > 0) {
            const slotObj = pack.slots[b.slot];
            slotObj.taken = true;
            slotObj.status = "taken";
            slotObj.owner_business_id = b.business_id;
          }
        }
      }

      results.push(pack);
    }

    // Bring into the shape the frontend expects (array or object is fine; we normalize)
    const response = results.map((r) => ({
      area_id: r.area_id,
      // keep an object (1/2/3) to save bandwidth; client already normalizes both forms
      slots: r.slots,
      // optional paint hint (not used here)
    }));

    return json({ areas: response });
  } catch (err) {
    console.error("area-sponsorship error:", err);
    return json({ error: "DB/geometry error" }, 500);
  }
};
