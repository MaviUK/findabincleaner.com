// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function parseRate(slot) {
  const map = {
    1: process.env.RATE_GOLD_PER_KM2_PER_MONTH,
    2: process.env.RATE_SILVER_PER_KM2_PER_MONTH,
    3: process.env.RATE_BRONZE_PER_KM2_PER_MONTH,
  };
  const raw = map[slot];
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null; // null -> UI shows "—"
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

  if (!areaId || !/^[0-9a-f-]{36}$/i.test(areaId)) return json({ ok: false, error: "Missing or invalid areaId" });
  if (![1, 2, 3].includes(slot)) return json({ ok: false, error: "Missing or invalid slot (1..3)" });

  try {
    const { data, error } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });

    if (error) return json({ ok: false, error: error.message || "Preview query failed" });

    const row = Array.isArray(data) ? data[0] : data;
    const area_km2 = Number(row?.area_km2 ?? 0);
    const geojson = row?.gj ?? null;

    const rate_per_km2 = parseRate(slot);
    const price_cents =
      rate_per_km2 == null || !Number.isFinite(area_km2)
        ? null
        : Math.max(0, Math.round(area_km2 * rate_per_km2 * 100)); // GBP→pennies

    return json({ ok: true, area_km2, rate_per_km2, price_cents, geojson });
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error" });
  }
};
