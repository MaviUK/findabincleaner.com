import { createClient } from "@supabase/supabase-js";
import area from "@turf/area";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const EPS = 1e-6;

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

  const areaId = (body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot || 1);
  const businessId = (body.businessId || body.cleanerId || "").trim();

  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);
  if (![1].includes(slot)) return json({ ok: false, error: "Invalid slot" }, 400); // only featured slot

  try {
    // 1) Load the saved service area geometry for "total area"
    const { data: sa, error: saErr } = await sb
      .from("service_areas")
      .select("gj")
      .eq("id", areaId)
      .maybeSingle();

    if (saErr) throw saErr;
    if (!sa || !sa.gj) {
      return json({ ok: false, error: "Service area geometry missing" }, 404);
    }

    let total_km2 = 0;
    try {
      const m2 = area(sa.gj);
      if (Number.isFinite(m2)) total_km2 = m2 / 1_000_000;
    } catch {
      total_km2 = 0;
    }

    // 2) Ask Supabase which part of this area is still available,
    //    excluding anything already owned by this cleaner but
    //    respecting sponsorships from OTHER cleaners.
    const { data: avData, error: avErr } = await sb.rpc("get_area_availability", {
      _area_id: areaId,
      _slot: slot,
      _exclude_cleaner: businessId,
    });
    if (avErr) throw avErr;

    const avRow = Array.isArray(avData) ? avData[0] || {} : avData || {};

    const availableGeom =
      avRow.available ??
      avRow.available_gj ??
      avRow.available_geojson ??
      avRow.final_geojson ??
      null;

    let available_km2 = 0;
    if (availableGeom && typeof availableGeom === "object") {
      try {
        const m2 = area(availableGeom);
        if (Number.isFinite(m2)) available_km2 = m2 / 1_000_000;
      } catch {
        available_km2 = 0;
      }
    }

    const sold_out = available_km2 <= EPS;

    // 3) Pricing
    const rate_per_km2 =
      Number(
        process.env.RATE_GOLD_PER_KM2_PER_MONTH ??
          process.env.RATE_PER_KM2_PER_MONTH ??
          0
      ) || 0;

    const price_cents = sold_out
      ? 0
      : Math.round(Math.max(available_km2, 0) * rate_per_km2 * 100);

    return json({
      ok: true,
      sold_out,
      available_km2: Math.max(0, available_km2),
      total_km2,
      rate_per_km2,
      price_cents,
      geojson: availableGeom, // highlight purchasable sub-region
      reason: sold_out ? "no_remaining" : "ok",
    });
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
