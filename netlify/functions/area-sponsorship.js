// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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
    // Prefer the view if it exists
    const { data, error } = await sb
      .from("v_area_slot_remaining")
      .select("area_id, slot, remaining_km2, sold_out")
      .in("area_id", areaIds);

    if (error) {
      console.error("[area-sponsorship] view query error:", error);
      // Fallback: return “empty” slots so UI still renders and preview check will decide availability
      const fallback = areaIds.map((id) => ({
        area_id: id,
        slots: [
          { slot: 1, taken: false, status: null, owner_business_id: null },
          { slot: 2, taken: false, status: null, owner_business_id: null },
          { slot: 3, taken: false, status: null, owner_business_id: null },
        ],
      }));
      return json({ areas: fallback });
    }

    // Group rows per area and expose a slot array the UI can consume
    const grouped = new Map();
    for (const r of data || []) {
      if (!grouped.has(r.area_id)) grouped.set(r.area_id, []);
      const soldOut = !!r.sold_out || Number(r.remaining_km2) <= 0;
      grouped.get(r.area_id).push({
        slot: Number(r.slot),
        // We don't assert ownership here; taken/status is handled by other code/preview.
        taken: false,
        status: soldOut ? "sold_out" : null,
        owner_business_id: null,
      });
    }

    // Ensure all three slots are present per area
    const areas = areaIds.map((id) => {
      const slots = grouped.get(id) || [];
      const bySlot = new Map(slots.map((s) => [s.slot, s]));
      const full = [1, 2, 3].map((n) =>
        bySlot.get(n) || { slot: n, taken: false, status: null, owner_business_id: null }
      );
      return { area_id: id, slots: full };
    });

    return json({ areas });
  } catch (err) {
    console.error("[area-sponsorship] fatal:", err);
    return json({ error: "Internal Server Error" }, 500);
  }
};
