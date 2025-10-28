// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";
import area from "@turf/area"; // <- NEW

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" });
  }

  const areaId = (body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot);
  if (!areaId || !/^[0-9a-f-]{36}$/i.test(areaId)) return json({ ok: false, error: "Missing or invalid areaId" });
  if (![1, 2, 3].includes(slot)) return json({ ok: false, error: "Missing or invalid slot (1..3)" });

  try {
    // remaining/purchasable sub-geometry + area (km²)
    const { data, error } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });
    if (error) return json({ ok: false, error: error.message || "Preview query failed" });

    const row = Array.isArray(data) ? data[0] : data;
    const area_km2 = Number(row?.area_km2 ?? 0) || 0;
    const geojson = row?.gj ?? null;

    // --- NEW: compute total area of the saved service area ---
    let total_km2 = null;
    const { data: sa, error: saErr } = await sb
      .from("service_areas")
      .select("gj")
      .eq("id", areaId)
      .maybeSingle();
    if (!saErr && sa?.gj) {
      try {
        const m2 = area(sa.gj); // turf returns m²
        if (Number.isFinite(m2)) total_km2 = m2 / 1_000_000;
      } catch {
        // ignore; total_km2 stays null
      }
    }

    // existing rate/price logic (if you already have it here, keep it; otherwise this is harmless)
    const rateMap = {
      1: Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0),
      2: Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0),
      3: Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0),
    };
    const rate_per_km2 = Number.isFinite(rateMap[slot]) ? rateMap[slot] : 0;
    const price_cents = Math.round(area_km2 * rate_per_km2 * 100);

    return json({
      ok: true,
      area_km2,
      total_km2,          // <- NEW
      rate_per_km2,
      price_cents,
      geojson,
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error" });
  }
};
