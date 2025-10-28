// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

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
    return json({ ok: false, error: "Invalid JSON body" }); // 200 with ok:false on client
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

    return json({
      ok: true,
      area_km2,
      geojson, // this is a GeoJSON geometry or null
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error" });
  }
};
