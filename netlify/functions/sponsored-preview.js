// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";
import * as turf from "@turf/turf";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// These statuses block a slot
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

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

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
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

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const areaId = body?.areaId || body?.area_id;
  const slot = Number(body?.slot);
  if (!areaId || !Number.isInteger(slot)) {
    return json({ ok: false, error: "Missing areaId or slot" }, 400);
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
    return json({ ok: false, error: "Server misconfigured: missing Supabase env" }, 500);
  }

  try {
    // 1) Load base area geometry
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

    // 2) Find blocking subscriptions in this slot
    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("status, final_geojson")
      .eq("area_id", areaId)
      .eq("slot", slot);

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
    }

    // 3) Subtract blockers (robustly)
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
    }

    const rate = rateForSlot(slot);
    const min = minForSlot(slot);
    const monthly = Math.max(km2 * rate, min);

    return json({
      ok: true,
      area_km2: Number(km2.toFixed(6)),
      monthly_price: Math.round(monthly * 100) / 100,
      final_geojson: available, // MultiPolygon of purchasable sub-region
    });
  } catch (e) {
    console.error("sponsored-preview unexpected error:", e);
    // Be conservative: do NOT allow purchase if we can't compute safely
    return json({ ok: true, area_km2: 0, monthly_price: 0, final_geojson: null });
  }
};
