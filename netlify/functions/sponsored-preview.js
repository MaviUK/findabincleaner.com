// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";
import * as turf from "@turf/turf";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Helpers */
const toNumber = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const round = (n, p = 4) => Number(n.toFixed(p));

/** Slot-specific pricing helpers with fallbacks */
function slotPricing(slot) {
  // Per-km² rates
  const rateAny = toNumber(process.env.RATE_PER_KM2_PER_MONTH, 0);
  const rateGold = toNumber(process.env.RATE_GOLD_PER_KM2_PER_MONTH, rateAny);
  const rateSilver = toNumber(
    process.env.RATE_SILVER_PER_KM2_PER_MONTH,
    rateAny
  );
  const rateBronze = toNumber(
    process.env.RATE_BRONZE_PER_KM2_PER_MONTH,
    rateAny
  );

  // Minimum monthly
  const minAny = toNumber(process.env.MIN_PRICE_PER_MONTH, 0);
  const minGold = toNumber(process.env.MIN_GOLD_PRICE_PER_MONTH, minAny);
  const minSilver = toNumber(process.env.MIN_SILVER_PRICE_PER_MONTH, minAny);
  const minBronze = toNumber(process.env.MIN_BRONZE_PRICE_PER_MONTH, minAny);

  if (slot === 1) return { rate: rateGold, min: minGold, label: "Gold" };
  if (slot === 2) return { rate: rateSilver, min: minSilver, label: "Silver" };
  return { rate: rateBronze, min: minBronze, label: "Bronze" };
}

/** Set of statuses that actually block a slot for others */
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

/** Accepts synonyms from the client payload */
function parseBody(body) {
  const businessId =
    body?.businessId || body?.cleanerId || body?.ownerId || null;
  const areaId = body?.areaId || body?.area_id || null;
  const slot = Number(body?.slot);
  if (!businessId || !areaId || !Number.isFinite(slot) || slot < 1 || slot > 3) {
    return { ok: false, error: "cleanerId, areaId, slot required" };
  }
  return { ok: true, businessId, areaId, slot };
}

/** Fetch the service area GeoJSON */
async function loadAreaGeoJSON(areaId) {
  const { data, error } = await sb
    .from("service_areas")
    .select("id, gj")
    .eq("id", areaId)
    .single();

  if (error) throw new Error("Area not found");
  const gj = data?.gj;
  if (!gj || (gj.type !== "Polygon" && gj.type !== "MultiPolygon")) {
    throw new Error("Area has invalid geometry");
  }
  return gj;
}

/** Compute area in km² (using turf) */
function areaKm2(geojson) {
  try {
    const m2 = turf.area(geojson);
    return m2 / 1_000_000;
  } catch {
    // Fallback: 0 if geometry fails
    return 0;
  }
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = parseBody(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const { businessId, areaId, slot } = parsed;

  try {
    // 1) Fetch the base area geometry
    const baseGeo = await loadAreaGeoJSON(areaId);

    // 2) Check if another business already blocks this slot
    const { data: blockers, error: blockErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id,status")
      .eq("area_id", areaId)
      .eq("slot", slot);

    if (blockErr) throw new Error("DB error while checking blockers");

    // Is there a blocking sub by someone else?
    const blockedByOther = (blockers || []).some(
      (r) => r.business_id !== businessId && BLOCKING.has(r.status)
    );

    // Also prevent one business holding multiple slots in the same area (business rule)
    const ownsAnotherSlot = (blockers || []).some(
      (r) => r.business_id === businessId && r.status && r.status !== "canceled"
    );
    const tryingSecondSlot =
      ownsAnotherSlot &&
      !(blockers || []).some(
        (r) => r.business_id === businessId && Number(r.slot) === slot
      );

    if (blockedByOther || tryingSecondSlot) {
      // No purchasable region in this preview
      return json({
        ok: true,
        area_km2: 0,
        monthly_price: 0,
        final_geojson: null,
      });
    }

    // 3) (Optional) Subtract geometry masks for over-subscribed sub-regions here.
    //    In the current data model, slots are whole-area claims, so if not blocked,
    //    the entire area is purchasable. If/when you add per-slot mask polygons,
    //    replace the `purchasableGeo = baseGeo` with a turf.difference/erase of
    //    the union of blocking masks.
    //
    //    Example:
    //    const unionMask = turf.union(...masksForThisSlot);
    //    const purchasableGeo = turf.difference(baseGeo, unionMask) || null;

    const purchasableGeo = baseGeo; // current baseline: whole area

    // 4) Compute area and price
    const km2 = purchasableGeo ? Math.max(0, areaKm2(purchasableGeo)) : 0;
    const { rate, min } = slotPricing(slot);

    // price = max(min, km2 * rate), rounded to 2dp
    const rawPrice = Math.max(min, km2 * rate);
    const monthly_price = round(rawPrice, 2);

    return json({
      ok: true,
      area_km2: round(km2, 4),
      monthly_price,
      final_geojson: purchasableGeo,
    });
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    // Return a descriptive error for the UI while keeping a 500 status
    return json({ ok: false, error: String(e?.message || e || "Preview failed") }, 500);
  }
};
