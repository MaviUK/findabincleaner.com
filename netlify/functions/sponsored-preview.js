// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import * as turf from "@turf/turf";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/* -------- shared pricing helpers -------- */
const ACTIVE_BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

function asMultiPolygon(geo) {
  if (!geo) return null;
  if (geo.type === "FeatureCollection" && Array.isArray(geo.features)) {
    const parts = geo.features.map(asMultiPolygon).filter(Boolean);
    if (!parts.length) return null;
    return parts.reduce((acc, g) => unionSafe(acc, g), null);
  }
  if (geo.type === "Feature" && geo.geometry) return asMultiPolygon(geo.geometry);
  if (geo.type === "Polygon") return turf.multiPolygon(geo.coordinates);
  if (geo.type === "MultiPolygon") return turf.multiPolygon(geo.coordinates);
  if (geo.gj) return asMultiPolygon(geo.gj);
  if (geo.geojson) return asMultiPolygon(geo.geojson);
  if (geo.geometry) return asMultiPolygon(geo.geometry);
  return null;
}
function unionSafe(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  try {
    const u = turf.union(a, b);
    return asMultiPolygon(u);
  } catch {
    try {
      const u = turf.union(turf.buffer(a, 0), turf.buffer(b, 0));
      return asMultiPolygon(u);
    } catch {
      return a;
    }
  }
}
function differenceSafe(a, b) {
  if (!a) return null;
  if (!b) return a;
  try {
    const d = turf.difference(a, b);
    return asMultiPolygon(d);
  } catch {
    try {
      const d = turf.difference(turf.buffer(a, 0), turf.buffer(b, 0));
      return asMultiPolygon(d);
    } catch {
      return a;
    }
  }
}
function km2FromArea(feature) {
  if (!feature) return 0;
  try {
    return turf.area(feature) / 1_000_000;
  } catch {
    return 0;
  }
}
function priceFor(slot, km2) {
  const s = Number(slot);
  const rate =
    s === 1
      ? Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0)
      : s === 2
      ? Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0)
      : Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0);

  const min =
    s === 1
      ? Number(process.env.MIN_GOLD_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 0)
      : s === 2
      ? Number(process.env.MIN_SILVER_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 0)
      : Number(process.env.MIN_BRONZE_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 0);

  if (km2 <= 0) return 0;
  const raw = Math.round(rate * km2 * 100) / 100;
  return Math.max(raw, min);
}

/* ----- compute preview (server-side) ----- */
async function computePreview({ businessId, areaId, slot }) {
  // area geometry
  const { data: areaRow, error: areaErr } = await sb
    .from("service_areas")
    .select("id, gj")
    .eq("id", areaId)
    .single();
  if (areaErr || !areaRow?.gj) throw new Error("area");

  const areaGeom = asMultiPolygon(areaRow.gj);
  if (!areaGeom) throw new Error("area-geom");

  // take same-slot subs (not mine)
  let subs, subsErr;
  const projections = [
    "id,business_id,status,slot,final_geojson",
    "id,business_id,status,slot,geo_footprint",
    "id,business_id,status,slot",
  ];
  for (const sel of projections) {
    const out = await sb
      .from("sponsored_subscriptions")
      .select(sel)
      .eq("area_id", areaId)
      .eq("slot", slot)
      .neq("business_id", businessId);
    if (out.error) {
      subsErr = out.error;
      continue;
    }
    subs = out.data || [];
    subsErr = null;
    break;
  }
  if (subsErr) throw new Error("subs");

  // union of taken footprints
  let takenUnion = null;
  let anyActiveWithoutFootprint = false;

  for (const row of subs) {
    if (!ACTIVE_BLOCKING.has(row.status)) continue;
    const footprint = row.final_geojson ?? row.geo_footprint ?? null;
    const g = asMultiPolygon(footprint);
    if (g) takenUnion = unionSafe(takenUnion, g);
    else anyActiveWithoutFootprint = true;
  }
  if (anyActiveWithoutFootprint) takenUnion = unionSafe(takenUnion, areaGeom);

  // available region
  const available = differenceSafe(areaGeom, takenUnion);
  const km2 = km2FromArea(available);
  const monthly = priceFor(slot, km2);

  return { ok: true, km2, monthly, available };
}

/* ---------------- handler ----------------- */
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const businessId = body?.businessId || body?.cleanerId;
  const areaId = body?.areaId || body?.area_id;
  const slot = Number(body?.slot);
  const returnBase = body?.return_url || process.env.PUBLIC_SITE_URL || "";

  if (!businessId || !areaId || !slot) {
    return json({ error: "businessId/cleanerId, areaId, and slot required" }, 400);
  }

  // Block if another business has the same slot active
  const BLOCKING = ["active", "trialing", "past_due", "unpaid"];
  const { data: conflicts, error: conflictErr } = await sb
    .from("sponsored_subscriptions")
    .select("id,business_id,status")
    .eq("area_id", areaId)
    .eq("slot", slot)
    .in("status", BLOCKING)
    .neq("business_id", businessId)
    .limit(1);

  if (conflictErr) return json({ error: "DB error (conflict)" }, 500);
  if (conflicts?.length) return json({ error: "Slot already taken" }, 409);

  // Reuse or create provisional
  const PROVISIONAL = ["incomplete", "incomplete_expired"];
  const { data: existing, error: existErr } = await sb
    .from("sponsored_subscriptions")
    .select("id,status")
    .eq("business_id", businessId)
    .eq("area_id", areaId)
    .eq("slot", slot)
    .in("status", PROVISIONAL)
    .order("created_at", { ascending: false })
    .limit(1);

  if (existErr) return json({ error: "DB error (lookup provisional)" }, 500);

  let subRowId;
  if (existing?.[0]) {
    subRowId = existing[0].id;
  } else {
    const { data: inserted, error: insErr } = await sb
      .from("sponsored_subscriptions")
      .insert({
        business_id: businessId,
        area_id: areaId,
        slot,
        status: "incomplete",
      })
      .select("id")
      .single();
    if (insErr || !inserted) return json({ error: "Could not create provisional subscription" }, 409);
    subRowId = inserted.id;
  }

  // Compute fresh preview server-side (NO previewUrl required)
  let preview;
  try {
    preview = await computePreview({ businessId, areaId, slot });
  } catch (e) {
    console.error("[checkout] preview failed:", e);
    return json({ error: "Preview failed" }, 500);
  }

  if (!preview?.ok || !Number.isFinite(preview.km2) || preview.km2 <= 0) {
    return json({ error: "No purchasable area left for this slot" }, 409);
  }

  const unitAmount = Math.round(preview.monthly * 100); // GBP -> pence

  // Create session using inline price_data
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price_data: {
          currency: "gbp",
          recurring: { interval: "month" },
          product_data: {
            name: `Sponsor Slot #${slot} — Area ${areaId}`,
            metadata: { area_id: areaId, slot: String(slot) },
          },
          unit_amount: unitAmount,
        },
        quantity: 1,
      },
    ],
    metadata: {
      sub_row_id: subRowId,
      business_id: businessId,
      area_id: areaId,
      slot: String(slot),
      // (Optional) Persist numbers to simplify webhook logic
      preview_km2: String(preview.km2),
      preview_monthly: String(preview.monthly),
    },
    success_url: `${returnBase}/#/dashboard?checkout=success`,
    cancel_url: `${returnBase}/#/dashboard?checkout=cancel`,
  });

  return json({ url: session.url });
};
