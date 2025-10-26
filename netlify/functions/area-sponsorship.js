// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

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

    // shape results
    const byArea = {};
    for (const area_id of areaIds) {
      byArea[area_id] = {
        area_id,
        slots: {
          1: { slot: 1, taken: false, status: null, by_business_id: null, paint: SLOT_COLORS[1] },
          2: { slot: 2, taken: false, status: null, by_business_id: null, paint: SLOT_COLORS[2] },
          3: { slot: 3, taken: false, status: null, by_business_id: null, paint: SLOT_COLORS[3] },
        },
      };
    }

    for (const row of data) {
      if (!byArea[row.area_id]) continue;
      if (BLOCKING.has(row.status)) {
        byArea[row.area_id].slots[row.slot] = {
          slot: row.slot,
          taken: true,
          status: row.status,
          by_business_id: row.business_id,
          paint: SLOT_COLORS[row.slot] || "#666",
        };
      }
    }

    return json({ areas: Object.values(byArea) });
  } catch (err) {
    console.error("area-sponsorship error:", err);
    return json({ error: "DB error" }, 500);
  }
};
