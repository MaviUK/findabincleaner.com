// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

console.log("RATES USED:", {
  gold: process.env.RATE_GOLD_PER_KM2_PER_MONTH,
  silver: process.env.RATE_SILVER_PER_KM2_PER_MONTH,
  bronze: process.env.RATE_BRONZE_PER_KM2_PER_MONTH,
});



const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// --- helpers for pricing ---
const toNum = (v) => (v == null ? null : Number(v));
const rateForSlot = (slot) => {
  switch (Number(slot)) {
    case 1:
      return toNum(process.env.RATE_GOLD_PER_KM2_PER_MONTH);
    case 2:
      return toNum(process.env.RATE_SILVER_PER_KM2_PER_MONTH);
    case 3:
      return toNum(process.env.RATE_BRONZE_PER_KM2_PER_MONTH);
    default:
      return null;
  }
};

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }); // keep 200 with ok:false for client
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
    // Call a tiny SQL helper that reads from v_area_slot_remaining and returns km2 + geojson
    const { data, error } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });

    if (error) {
      return json({ ok: false, error: error.message || "Preview query failed" });
    }

    // If no row, treat as zero/none rather than throwing
    const row = Array.isArray(data) ? data[0] : data;

    const area_km2 = Number(row?.area_km2 ?? 0);
    const geojson = row?.gj ?? null;

    // ---- pricing from env rates ----
    const rate = rateForSlot(slot); // £ per km² per month
    let price_cents = null;
    if (Number.isFinite(rate) && area_km2 > 0) {
      const gbp = area_km2 * rate;
      price_cents = Math.round(gbp * 100); // integer cents
    }
    // --------------------------------

    return json({
      ok: true,
      area_km2,
      geojson,             // GeoJSON geometry or null (your preview overlay)
      price_cents,         // integer pence (null if no rate set or zero area)
      currency: "gbp",
      rate_per_km2: Number.isFinite(rate) ? rate : null, // helpful for debugging UI
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error" });
  }
};
