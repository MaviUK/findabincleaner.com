// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE
);

// Small helper to send JSON
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
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

  const areaIds = Array.isArray(body?.areaIds) ? body.areaIds.filter(Boolean) : [];
  if (!areaIds.length) return json({ areas: [] });
    // Body shape: { areaIds: string[] }
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

  try {
    // ✅ Use the new SQL view so it includes the correct remaining + sold_out
    const { data, error } = await sb
    const areaIds = Array.isArray(body?.areaIds)
      ? body.areaIds.filter(Boolean)
      : [];

    if (!areaIds.length) {
      return json([]); // flat array (what the UI expects)
    }

    // Pull remaining availability from the view (already computes overlaps)
    // View columns: area_id (uuid), slot (int), remaining_km2 (numeric), sold_out (bool)
    const { data, error } = await supabase
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
      .in("area_id", areaIds)
      .order("area_id", { ascending: true })
      .order("slot", { ascending: true });

    if (error) {
      console.error("area-sponsorship query error:", error);
      return json({ error: "Database error" }, 500);
}

    return json({ areas: grouped });
    // Ensure we always return a FLAT ARRAY for the frontend
    // e.g. [{ area_id, slot, remaining_km2, sold_out }, ...]
    const results = (data ?? []).map((row) => ({
      area_id: row.area_id,
      slot: row.slot,
      // coerce to number where possible; UI only displays, so keep as-is if null
      remaining_km2:
        typeof row.remaining_km2 === "number"
          ? row.remaining_km2
          : row.remaining_km2 == null
          ? null
          : Number(row.remaining_km2),
      sold_out: !!row.sold_out,
    }));

    return json(results, 200);
} catch (err) {
    console.error("area-sponsorship error", err);
    return json({ error: err.message || "Server error" }, 500);
    console.error("area-sponsorship fatal error:", err);
    return json({ error: "Internal Server Error" }, 500);
}
};
