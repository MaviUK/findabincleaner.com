// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// Only these statuses block a slot
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

const SLOT_COLORS = {
  1: { tier: 1, fill: "rgba(255,215,0,0.35)", stroke: "#B8860B" },   // gold
  2: { tier: 2, fill: "rgba(192,192,192,0.35)", stroke: "#708090" }, // silver
  3: { tier: 3, fill: "rgba(205,127,50,0.35)", stroke: "#8B5A2B" },  // bronze
};

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
    // Get all subs for these areas (for all 3 slots)
    const { data, error } = await sb
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id, final_geojson")
      .in("area_id", areaIds);

    if (error) throw error;

    // Build a normalized response: one entry per area_id, with slots as an ARRAY
    const byArea = new Map();

    for (const area_id of areaIds) {
      byArea.set(area_id, {
        area_id,
        // array form is simpler/safer on the client
        slots: [
          { slot: 1, taken: false, status: null, owner_business_id: null },
          { slot: 2, taken: false, status: null, owner_business_id: null },
          { slot: 3, taken: false, status: null, owner_business_id: null },
        ],
        paint: SLOT_COLORS[1], // paint is just “default look” for the map; not used for gating
      });
    }

    for (const row of data ?? []) {
      const entry = byArea.get(row.area_id);
      if (!entry) continue;

      // Only blocking statuses should flip taken=true
      if (!BLOCKING.has(row.status)) continue;

      const idx = [1, 2, 3].indexOf(row.slot);
      if (idx === -1) continue;

      entry.slots[idx] = {
        slot: row.slot,
        taken: true,
        status: row.status,
        owner_business_id: row.business_id, // <-- important: exact key the UI expects
      };
    }

    return json({ areas: Array.from(byArea.values()) });
  } catch (err) {
    console.error("area-sponsorship error:", err);
    return json({ error: "DB error" }, 500);
  }
};
