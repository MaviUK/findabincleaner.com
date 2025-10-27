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
 * For each requested areaId, we report per-slot availability:
 * - We compute `available = area.gj - union(all blocking subs for that slot)`
 * - slot.taken = (area(available) === 0)  // fully blocked -> cannot buy
 * - If fully blocked, we also return owner_business_id of *a* blocker (first seen).
 *
 * This lets partially overlapped areas remain purchasable.
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
    // 1) Load requested areas (id, owner, geom)
    const { data: areas, error: areasErr } = await sb
      .from("service_areas")
      .select("id, business_id, gj")
      .in("id", areaIds);

    if (areasErr) throw areasErr;

    // Prepare turf multipolygons
    const requestedById = {};
    for (const a of areas || []) {
      if (!a?.gj) continue;
      let mp;
      if (a.gj.type === "Polygon") mp = turf.multiPolygon([a.gj.coordinates]);
      else if (a.gj.type === "MultiPolygon") mp = turf.multiPolygon(a.gj.coordinates);
      else continue;
      requestedById[a.id] = { id: a.id, business_id: a.business_id, turf: mp };
    }

    // 2) Pull ALL blocking subs (all areas; all slots)
    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id, final_geojson");

    if (subsErr) throw subsErr;

    const blockersRaw = (subs || []).filter((s) => BLOCKING.has(s.status));

    // 3) Load geometry for blockers that have no final_geojson
    const needAreaIds = Array.from(
      new Set(blockersRaw.filter((s) => !s.final_geojson && s.area_id).map((s) => s.area_id))
    ).filter((id) => !requestedById[id]); // we may already have it if requested

    const areaGeomById = new Map();
    if (needAreaIds.length) {
      const { data: moreAreas, error: moreAreasErr } = await sb
        .from("service_areas")
        .select("id, gj")
        .in("id", needAreaIds);
      if (moreAreasErr) throw moreAreasErr;
      for (const a of moreAreas || []) {
        areaGeomById.set(a.id, a.gj);
      }
    }

    // Helper: make a multipolygon from possible Polygon/MultiPolygon
    const toMP = (g) => {
      if (!g) return null;
      if (g.type === "Polygon") return turf.multiPolygon([g.coordinates]);
      if (g.type === "MultiPolygon") return turf.multiPolygon(g.coordinates);
      return null;
    };

    // 4) Build blockers per slot as array of { business_id, geom }
    const blockersBySlot = { 1: [], 2: [], 3: [] };
    for (const s of blockersRaw) {
      let g = s.final_geojson;
      if (!g && s.area_id && areaGeomById.has(s.area_id)) g = areaGeomById.get(s.area_id);
      const mp = toMP(g);
      if (!mp || !(s.slot === 1 || s.slot === 2 || s.slot === 3)) continue;
      blockersBySlot[s.slot].push({ business_id: s.business_id, geom: mp });
    }

    // 5) For each requested area, compute remaining geometry per slot
    const out = [];
    for (const a of areas || []) {
      const base = requestedById[a.id]?.turf;
      if (!base) {
        out.push({
          area_id: a.id,
          slots: {
            1: { slot: 1, taken: false, status: null, owner_business_id: null, paint: SLOT_COLORS[1] },
            2: { slot: 2, taken: false, status: null, owner_business_id: null, paint: SLOT_COLORS[2] },
            3: { slot: 3, taken: false, status: null, owner_business_id: null, paint: SLOT_COLORS[3] },
          },
        });
        continue;
      }

      const pack = {
        area_id: a.id,
        slots: {
          1: { slot: 1, taken: false, status: null, owner_business_id: null, paint: SLOT_COLORS[1] },
          2: { slot: 2, taken: false, status: null, owner_business_id: null, paint: SLOT_COLORS[2] },
          3: { slot: 3, taken: false, status: null, owner_business_id: null, paint: SLOT_COLORS[3] },
        },
      };

      for (const slot of [1, 2, 3]) {
        let remaining = base;
        let anyBlockerTouched = false;
        for (const b of blockersBySlot[slot]) {
          // skip quick if disjoint
          if (turf.booleanDisjoint(remaining, b.geom)) continue;

          anyBlockerTouched = true;
          try {
            const diff = turf.difference(remaining, b.geom);
            remaining = diff || turf.multiPolygon([]);
          } catch (e) {
            // If difference fails (rare self-intersection), treat as blocked chunk and continue
            try {
              if (!turf.booleanDisjoint(base, b.geom)) {
                // still mark that we had blockers
                anyBlockerTouched = true;
              }
            } catch {}
          }
        }

        const m2 = turf.area(remaining);
        // Treat as taken only if NOTHING remains
        if (anyBlockerTouched && m2 <= 1e-6) {
          pack.slots[slot].taken = true;
          pack.slots[slot].status = "taken";
          // set to the first blocker’s owner we encountered (best-effort)
          const owner = blockersBySlot[slot][0]?.business_id ?? null;
          pack.slots[slot].owner_business_id = owner;
        }
      }

      out.push(pack);
    }

    return json({ areas: out });
  } catch (err) {
    console.error("area-sponsorship error:", err);
    return json({ error: "DB/geometry error" }, 500);
  }
};
