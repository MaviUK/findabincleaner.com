// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";
import area from "@turf/area";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const BLOCKING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const areaId = (body.areaId || "").trim();
  const businessId = (body.businessId || body.cleanerId || "").trim();
  const slot = Number(body.slot || 1);

  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);
  if (![1].includes(slot)) return json({ ok: false, error: "Invalid slot" }, 400); // single featured slot

  try {
    // 1) Who owns this slot, if anyone?
    const { data: takenRows, error: takenErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id, status")
      .eq("area_id", areaId)
      .eq("slot", slot)
      .order("created_at", { ascending: false })
      .limit(1);

    if (takenErr) return json({ ok: false, error: takenErr.message || "Ownership check failed" }, 500);

    const hasRow = Array.isArray(takenRows) && takenRows.length > 0;
    const row = hasRow ? takenRows[0] : null;
    const rowStatus = String(row?.status || "").toLowerCase();
    const ownedByOther = hasRow && BLOCKING.has(rowStatus) && row.business_id !== businessId;

    // 2) Compute remaining purchasable sub-geometry via your RPC
    //    (If you don’t have partial-geometry logic, you can return the whole polygon.
    //     We still block below if somebody else owns it.)
    const { data: prevData, error: prevErr } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });

    if (prevErr) return json({ ok: false, error: prevErr.message || "Preview query failed" }, 500);

    const row0 = Array.isArray(prevData) ? prevData[0] : prevData || {};
    const km2 = Number(row0?.area_km2 ?? 0);
    const previewGeo = row0?.gj ?? null;

    // 3) Compute total_km2 from service_areas.gj with turf.area
    let total_km2 = null;
    const { data: sa, error: saErr } = await sb
      .from("service_areas")
      .select("gj")
      .eq("id", areaId)
      .maybeSingle();
    if (!saErr && sa?.gj) {
      try {
        const m2 = area(sa.gj); // m²
        if (Number.isFinite(m2)) total_km2 = m2 / 1_000_000;
      } catch {
        // ignore
      }
    }

    // 4) Pricing (use your env rates)
    const rate_per_km2 =
      Number(process.env.RATE_PER_KM2_PER_MONTH) ||
      Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH) ||
      1;
    const floor_monthly =
      Number(process.env.MIN_PRICE_PER_MONTH) ||
      Number(process.env.MIN_GOLD_PRICE_PER_MONTH) ||
      1;

    // 5) If owned by another business, report as sold_out and expose owner id; set area to 0
    if (ownedByOther) {
      return json({
        ok: true,
        sold_out: true,
        sold_to_business_id: row?.business_id || null,
        area_km2: 0,
        total_km2,
        rate_per_km2,
        floor_monthly,
        unit_currency: "GBP",
        geojson: null, // don’t preview when owned by someone else
      });
    }

    // 6) Otherwise return available preview
    return json({
      ok: true,
      sold_out: false,
      sold_to_business_id: null,
      area_km2: Number.isFinite(km2) ? km2 : 0,
      total_km2,
      rate_per_km2,
      floor_monthly,
      unit_currency: "GBP",
      geojson: previewGeo || null,
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
