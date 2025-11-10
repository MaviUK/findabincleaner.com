// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";
import turfArea from "@turf/area";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Any of these means the area is taken for Featured (single-slot)
const BLOCKING = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
];

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const areaId = (body.areaId || body.area_id || "").trim();
  const businessId = (body.businessId || body.cleanerId || "").trim(); // who is asking
  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);

  try {
    // 1) SOLD-OUT CHECK: does ANYONE already hold Featured for this area?
    const { data: takenRows, error: takenErr } = await sb
      .from("sponsored_subscriptions")
      .select("id,business_id,status,created_at")
      .eq("area_id", areaId)
      .in("status", BLOCKING)
      .order("created_at", { ascending: false })
      .limit(1);

    if (takenErr) throw takenErr;

    const soldOut = (takenRows?.length || 0) > 0;
    const soldTo = soldOut ? takenRows![0].business_id : null;

    // 2) Load the saved service-area geometry so we can compute total_km2
    let total_km2 = null;
    const { data: sa, error: saErr } = await sb
      .from("service_areas")
      .select("gj")
      .eq("id", areaId)
      .maybeSingle();
    if (saErr) throw saErr;

    if (sa?.gj) {
      try {
        const m2 = turfArea(sa.gj);
        if (Number.isFinite(m2)) total_km2 = m2 / 1_000_000;
      } catch {
        // swallow, keep null
      }
    }

    // 3) If someone else already owns Featured, force available area to 0 and no overlay
    // (Single-slot product: there is nothing left to buy in this area.)
    let area_km2 = 0;
    let geojson = null;

    if (!soldOut /* nothing taken yet */) {
      // If you also intersect with existing shapes for a multi-slot model, do that here.
      // For single-slot Featured, the purchasable region is simply "the whole saved area".
      area_km2 = total_km2 ?? 0;
      geojson = sa?.gj ?? null;
    }

    // 4) Price signals (major units)
    const unit_price =
      Number(process.env.RATE_PER_KM2_PER_MONTH) ||
      Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH) ||
      0;
    const min_monthly =
      Number(process.env.MIN_PRICE_PER_MONTH) ||
      Number(process.env.MIN_GOLD_PRICE_PER_MONTH) ||
      0;
    const unit_currency = "GBP";

    const rawMonthly = (area_km2 || 0) * (unit_price || 0);
    const monthly_price = Math.max(min_monthly || 0, Number.isFinite(rawMonthly) ? rawMonthly : 0);

    return json({
      ok: true,
      // geometry
      geojson,
      // areas
      area_km2: Number.isFinite(area_km2) ? area_km2 : 0,
      total_km2: Number.isFinite(total_km2) ? total_km2 : null,
      // pricing
      unit_price,
      min_monthly,
      unit_currency,
      monthly_price,
      // saleability
      sold_out: soldOut,
      sold_to_business_id: soldTo,
      // helpful to the client for messaging
      is_owner: soldOut && businessId && soldTo === businessId,
    });
  } catch (e) {
    console.error("[sponsored-preview] error", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
