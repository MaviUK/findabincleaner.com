// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";
import { area as turfArea } from "@turf/turf"; // use @turf/turf (matches your Netlify externals)

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// clamp to 2dp, non-negative
const clamp2 = (n) => Math.max(0, Math.round(n * 100) / 100);

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const areaId = (body.areaId || body.area_id || "").trim();
  if (!areaId || !/^[0-9a-f-]{36}$/i.test(areaId)) {
    return json({ ok: false, error: "Missing or invalid areaId" }, 400);
  }

  // Single-slot world: accept 'slot' but ignore it; always treat as featured (1).
  const SLOT = 1;

  try {
    // 1) Remaining/purchasable sub-geometry + area (km²)
    const { data, error } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: SLOT,
    });
    if (error) return json({ ok: false, error: error.message || "Preview query failed" }, 200);

    const row = Array.isArray(data) ? data[0] : data;
    const area_km2 = Number(row?.area_km2 ?? 0) || 0;
    const geojson = row?.gj ?? null;

    // 2) Total area of the saved service area (km²), computed with Turf
    let total_km2 = null;
    const { data: sa, error: saErr } = await sb
      .from("service_areas")
      .select("gj")
      .eq("id", areaId)
      .maybeSingle();
    if (!saErr && sa?.gj) {
      try {
        const m2 = turfArea(sa.gj); // returns m²
        if (Number.isFinite(m2)) total_km2 = m2 / 1_000_000;
      } catch {
        // ignore
      }
    }

    // 3) Pricing (major units). Prefer unified env; fall back to legacy if present.
    const unit_price =
      Number(process.env.RATE_PER_KM2_PER_MONTH ?? "") ||
      Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? "") ||
      Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH ?? "") ||
      Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH ?? "") ||
      0;

    const min_monthly =
      Number(process.env.MIN_PRICE_PER_MONTH ?? "") ||
      Number(process.env.MIN_GOLD_PRICE_PER_MONTH ?? "") ||
      Number(process.env.MIN_SILVER_PER_MONTH ?? process.env.MIN_SILVER_PRICE_PER_MONTH ?? "") ||
      Number(process.env.MIN_BRONZE_PER_MONTH ?? process.env.MIN_BRONZE_PRICE_PER_MONTH ?? "") ||
      0;

    const unit_currency = "GBP";

    // Derived monthly: apply minimum if set
    const rawMonthly = area_km2 * unit_price;
    const monthly_price = clamp2(Math.max(min_monthly, rawMonthly));

    // Pence fallbacks for older clients
    const unit_price_pence = Math.round(unit_price * 100);
    const min_monthly_pence = Math.round(min_monthly * 100);
    const monthly_price_pence = Math.round(monthly_price * 100);

    return json(
      {
        ok: true,
        geojson,
        area_km2,
        total_km2,

        // pricing (major units)
        unit_price,
        unit_currency,
        min_monthly,
        monthly_price,

        // pence fallbacks
        unit_price_pence,
        min_monthly_pence,
        monthly_price_pence,
      },
      200
    );
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
