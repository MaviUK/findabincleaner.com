// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";
import * as turf from "@turf/turf";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

// Hard-blocking statuses per spec
const HARD_BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);
// Minutes to treat `incomplete` as a temporary hold
const HOLD_MINUTES = Number(process.env.INCOMPLETE_HOLD_MINUTES || 35);
// Small epsilon to avoid rounding noise
const EPS_KM2 = 1e-5;

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

// pricing helpers
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

// paint colors (optional)
const SLOT_COLORS = {
  1: "#f59e0b", // gold
  2: "#9ca3af", // silver
  3: "#cd7f32", // bronze
};
function hexToRgba(hex, a) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(0,0,0,${a})`;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${a})`;
}
function darken(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return "#555";
  const d = (v) => Math.max(0, parseInt(v, 16) - 60).toString(16).padStart(2, "0");
  return `#${d(m[1])}${d(m[2])}${d(m[3])}`;
}

// geometry hygiene to avoid turf edge-cases
function toMulti(geo) {
  if (!geo) return null;
  try {
    let g = geo.type === "Feature" ? geo.geometry : geo;
    if (g.type === "Polygon") g = turf.multiPolygon([g.coordinates]);
    if (g.type === "MultiPolygon") {
      // clean + rewind to right-hand rule
      g = turf.cleanCoords(g);
      g = turf.rewind(g, { reverse: false });
      return g;
    }
  } catch {}
  return null;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const areaIds = Array.isArray(body?.areaIds) ? body.areaIds.filter(Boolean) : [];
  if (!areaIds.length) return json({ areas: [] });

  try {
    // 1) Load all requested areas' geometries
    const { data: myAreas, error: myErr } = await sb
      .from("service_areas")
      .select("id, gj")
      .in("id", areaIds);
    if (myErr) throw myErr;

    const baseByArea = {};
    for (const r of myAreas || []) {
      const m = toMulti(r.gj);
      if (m) baseByArea[r.id] = m;
    }

    // 2) Load all subs for *all three slots* (global, not just these areas)
    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id, final_geojson, created_at");
    if (subsErr) throw subsErr;

    // Blocking rows per slot
    const blockersBySlot = { 1: [], 2: [], 3: [] };
    for (const row of subs || []) {
      if (![1, 2, 3].includes(row.slot)) continue;
      if (isBlockingRow(row)) blockersBySlot[row.slot].push(row);
    }

    // 3) For blockers with NULL final_geojson, fetch their full area polygons
    const needWholeIds = Array.from(
      new Set(
        Object.values(blockersBySlot)
          .flat()
          .filter((b) => !b.final_geojson)
          .map((b) => b.area_id)
          .filter(Boolean)
      )
    );

    let wholeMap = {};
    if (needWholeIds.length) {
      const { data: wholeAreas, error: wErr } = await sb
        .from("service_areas")
        .select("id, gj")
        .in("id", needWholeIds);
      if (wErr) throw wErr;
      wholeMap = Object.fromEntries(
        (wholeAreas || []).map((a) => [a.id, toMulti(a.gj)])
      );
    }

    // 4) Compute per-area *per slot* availability (leftover km² and price)
    const results = [];
    for (const areaId of areaIds) {
      const base = baseByArea[areaId];
      if (!base) {
        results.push({
          area_id: areaId,
          slots: [1, 2, 3].map((s) => ({
            slot: s, purchasable: false, reason: "No geometry", leftover_km2: 0, monthly_price: 0,
          })),
          paint: { tier: 0, fill: "rgba(0,0,0,0.0)", stroke: "#555" },
        });
        continue;
      }

      const slotsOut = [];
      for (const s of [1, 2, 3]) {
        let available = base;
        const blockers = blockersBySlot[s];

        for (const b of blockers) {
          let g = b.final_geojson ? toMulti(b.final_geojson) : (wholeMap[b.area_id] || null);
          if (!g) continue;

          try {
            // skip if no overlap
            if (!turf.intersect(available, g)) continue;
            available = turf.difference(available, g) || turf.multiPolygon([]);
          } catch (e) {
            // if a difference fails, conservatively treat as fully blocked
            available = turf.multiPolygon([]);
            break;
          }
        }

        const km2 = turf.area(available) / 1e6;
        const purchasable = km2 > EPS_KM2;
        const monthly = purchasable
          ? Math.max(km2 * rateForSlot(s), minForSlot(s))
          : 0;

        slotsOut.push({
          slot: s,
          purchasable,
          leftover_km2: Number(km2.toFixed(6)),
          monthly_price: Math.round(monthly * 100) / 100,
          reason: purchasable ? null : "Overlaps an existing sponsor or hold",
        });
      }

      // pick paint by highest taken tier (1>2>3) for that area snapshot
      const takenTier =
        (blockersBySlot[1].length ? 1 : 0) ||
        (blockersBySlot[2].length ? 2 : 0) ||
        (blockersBySlot[3].length ? 3 : 0);

      const color = takenTier ? SLOT_COLORS[takenTier] : null;
      const paint = takenTier
        ? { tier: takenTier, fill: hexToRgba(color, 0.35), stroke: darken(color) }
        : { tier: 0, fill: "rgba(0,0,0,0.0)", stroke: "#555" };

      results.push({ area_id: areaId, slots: slotsOut, paint });
    }

    return json({ areas: results });
  } catch (err) {
    console.error("area-sponsorship availability error:", err);
    return json({ error: "DB/geometry error" }, 500);
  }
};
