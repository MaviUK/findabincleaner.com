// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// Blocking statuses
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

const SLOT_COLORS = {
  1: "#f59e0b", // gold
  2: "#9ca3af", // silver
  3: "#cd7f32", // bronze
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
    const { data, error } = await sb
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id, final_geojson")
      .in("area_id", areaIds);

    if (error) throw error;

    // Initialize
    const byArea = {};
    for (const id of areaIds) {
      byArea[id] = {
        area_id: id,
        // internal slots map; we’ll flatten before returning
        slots: {
          1: { slot: 1, taken: false, status: null, owner_business_id: null, paint: SLOT_COLORS[1] },
          2: { slot: 2, taken: false, status: null, owner_business_id: null, paint: SLOT_COLORS[2] },
          3: { slot: 3, taken: false, status: null, owner_business_id: null, paint: SLOT_COLORS[3] },
        },
        // optional paint scheme per-area (kept for map overlays if you use it)
        paint: undefined,
      };
    }

    for (const row of data || []) {
      const area = byArea[row.area_id];
      if (!area) continue;

      const slot = Number(row.slot);
      if (![1, 2, 3].includes(slot)) continue;

      const status = String(row.status || "").toLowerCase();
      if (BLOCKING.has(status)) {
        area.slots[slot] = {
          slot,
          taken: true,
          status,
          owner_business_id: row.business_id,
          paint: SLOT_COLORS[slot] || "#666",
        };
      }
    }

    // Flatten slots map → array to keep the client simple & consistent
    const areas = Object.values(byArea).map((a) => ({
      area_id: a.area_id,
      slots: [a.slots[1], a.slots[2], a.slots[3]],
      paint: a.paint,
    }));

    return json({ areas });
  } catch (err) {
    console.error("area-sponsorship error:", err);
    return json({ error: "DB error" }, 500);
  }
};
