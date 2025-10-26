// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";
import * as turf from "@turf/turf";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const json = (b, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);
const PROVISIONAL = new Set(["incomplete", "incomplete_expired"]);

function pickId(body) {
  return body?.businessId || body?.cleanerId || body?.ownerId || null;
}
function pickArea(body) {
  return body?.areaId || body?.area_id || null;
}
function pickSlot(body) {
  const s = Number(body?.slot);
  return s === 1 || s === 2 || s === 3 ? s : null;
}

function priceFor(slot, km2) {
  const num = (v, fb) => (v != null && v !== "" ? Number(v) : fb);

  const base = num(process.env.RATE_PER_KM2_PER_MONTH, 1);
  const minBase = num(process.env.MIN_PRICE_PER_MONTH, 1);

  const perSlot = {
    1: num(process.env.RATE_GOLD_PER_KM2_PER_MONTH, base),
    2: num(process.env.RATE_SILVER_PER_KM2_PER_MONTH, base),
    3: num(process.env.RATE_BRONZE_PER_KM2_PER_MONTH, base),
  };
  const minPerSlot = {
    1: num(process.env.MIN_GOLD_PRICE_PER_MONTH, minBase),
    2: num(process.env.MIN_SILVER_PRICE_PER_MONTH, minBase),
    3: num(process.env.MIN_BRONZE_PRICE_PER_MONTH, minBase),
  };

  const variable = km2 * perSlot[slot];
  return Math.max(variable, minPerSlot[slot]);
}

function ensureMultiPolygon(gj) {
  // Accept MultiPolygon as-is, or wrap a Polygon to MultiPolygon
  if (!gj) return null;
  if (gj.type === "Feature") return ensureMultiPolygon(gj.geometry);
  if (gj.type === "FeatureCollection") return ensureMultiPolygon(gj.features?.[0]?.geometry);
  if (gj.type === "MultiPolygon") return gj;
  if (gj.type === "Polygon") return { type: "MultiPolygon", coordinates: [gj.coordinates] };
  return null;
}

function feature(multi) {
  return { type: "Feature", properties: {}, geometry: multi };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const businessId = pickId(body);
  const areaId = pickArea(body);
  const slot = pickSlot(body);

  if (!businessId || !areaId || !slot) {
    return json({ error: "cleanerId/businessId, areaId, slot required" }, 400);
  }

  try {
    // 1) Load the area geometry
    const { data: areaRow, error: areaErr } = await sb
      .from("service_areas")
      .select("id, gj")
      .eq("id", areaId)
      .single();

    if (areaErr) throw areaErr;
    const areaMP = ensureMultiPolygon(areaRow?.gj);
    if (!areaMP) return json({ ok: false, error: "Area geometry missing" }, 400);

    let available = feature(areaMP); // start with the full area

    // 2) Gather blocking winners for the same area+slot, not this business
    const { data: subs, error: subErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id, status, final_geojson")
      .eq("area_id", areaId)
      .eq("slot", slot);

    if (subErr) throw subErr;

    // union all blocking coverage
    let blocker = null;
    for (const s of subs || []) {
      const isOther = s.business_id && s.business_id !== businessId;
      const isBlocking = BLOCKING.has(s.status);
      if (!isOther || !isBlocking) continue;

      const winnerMP = ensureMultiPolygon(s.final_geojson) || areaMP; // fallback to whole area if we have no winner geometry
      const f = feature(winnerMP);
      blocker = blocker ? turf.union(blocker, f) : f;
    }

    // 3) Subtract blockers
    if (blocker) {
      try {
        const diff = turf.difference(available, blocker);
        if (diff && diff.geometry && (diff.geometry.coordinates?.length ?? 0) > 0) {
          available = diff;
        } else {
          // no remaining material
          available = null;
        }
      } catch (e) {
        console.error("[preview] difference failed, treating as fully blocked:", e);
        available = null;
      }
    }

    // 4) Compute km²
    let km2 = 0;
    if (available) {
      try {
        const a = turf.area(available); // m²
        km2 = a / 1_000_000;
      } catch (e) {
        console.error("[preview] area calc failed:", e);
      }
    }

    const monthly = km2 > 0 ? priceFor(slot, km2) : 0;

    return json({
      ok: true,
      area_km2: Number(km2.toFixed(4)),
      monthly_price: monthly ? Number(monthly.toFixed(2)) : 0,
      final_geojson: available?.geometry ?? null,
    });
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    return json({ ok: false, error: "DB error" }, 500);
  }
};
