import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const areaIds = Array.isArray(body?.areaIds) ? body.areaIds.filter(Boolean) : [];
  if (!areaIds.length) return json({ areas: [] });

  try {
    // ✅ Use the new SQL view so it includes the correct remaining + sold_out
    const { data, error } = await sb
      .from("v_area_slot_remaining")
      .select("area_id, slot, remaining_km2, sold_out")
      .in("area_id", areaIds);

    if (error) throw error;

    // group slots by area_id for frontend
    const grouped = {};
    for (const row of data || []) {
      if (!grouped[row.area_id]) grouped[row.area_id] = [];
      grouped[row.area_id].push({
        slot: row.slot,
        remaining_km2: row.remaining_km2,
        sold_out: row.sold_out,
      });
    }

    return json({ areas: grouped });
  } catch (err) {
    console.error("area-sponsorship error", err);
    return json({ error: err.message || "Server error" }, 500);
  }
};
