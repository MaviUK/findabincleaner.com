// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// helper: pick correct rate from env by slot
function rateForSlot(slot) {
  const g = Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? NaN);
  const s = Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? NaN);
  const b = Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? NaN);
  if (slot === 1) return g;
  if (slot === 2) return s;
  if (slot === 3) return b;
  return NaN;
}

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

  if (!areaId || !/^[0-9a-f-]{36}$/i.test(areaId)) {
    return json({ ok: false, error: "Missing or invalid areaId" });
  }
  if (![1, 2, 3].includes(slot)) {
    return json({ ok: false, error: "Missing or invalid slot (1..3)" });
  }

  try {
    const { data, error } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });
    if (error) return json({ ok: false, error: error.message || "Preview query failed" });

    const row = Array.isArray(data) ? data[0] : data;
    const area_km2 = Number(row?.area_km2 ?? 0);
    const geojson = row?.gj ?? null;

    const rate_per_km2 = rateForSlot(slot);               // £ per km² per month
    const price_cents =
      Number.isFinite(rate_per_km2) && Number.isFinite(area_km2)
        ? Math.round(area_km2 * rate_per_km2 * 100)
        : null;

    return json({
      ok: true,
      area_km2,
      geojson,          // used to draw the green preview
      rate_per_km2,     // for display/debug
      price_cents,      // <-- frontend will show this
      currency: "gbp",
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error" });
  }
};
