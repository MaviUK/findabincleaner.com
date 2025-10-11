// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const COLORS = {
  gold:   { fill: "rgba(255,215,0,0.35)",  stroke: "#B8860B" },
  silver: { fill: "rgba(192,192,192,0.35)", stroke: "#708090" },
  bronze: { fill: "rgba(205,127,50,0.35)",  stroke: "#8B5A2B" },
  none:   { fill: "rgba(0,0,0,0)",          stroke: "#555" },
};

function colorForSlots(slots) {
  // Highest live slot wins: #1 gold, else #2 silver, else #3 bronze, else none.
  const has1 = slots.some(s => s.slot === 1 && (s.status === 'active' || s.status === 'past_due'));
  const has2 = slots.some(s => s.slot === 2 && (s.status === 'active' || s.status === 'past_due'));
  const has3 = slots.some(s => s.slot === 3 && (s.status === 'active' || s.status === 'past_due'));
  if (has1) return { tier: 1, ...COLORS.gold };
  if (has2) return { tier: 2, ...COLORS.silver };
  if (has3) return { tier: 3, ...COLORS.bronze };
  return { tier: 0, ...COLORS.none };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const { areaIds } = await req.json();
  if (!Array.isArray(areaIds) || areaIds.length === 0) {
    return json({ error: "areaIds (array) required" }, 400);
  }
  // v_area_slot_status + area metadata (name, polygon, etc.) if you want to return geojson too
  const { data, error } = await supabase
    .from('v_area_slot_status')
    .select('area_id, slot, status, business_id')
    .in('area_id', areaIds);

  if (error) return json({ error: error.message }, 500);

  // Group by area_id
  const byArea = new Map();
  for (const row of (data || [])) {
    if (!byArea.has(row.area_id)) byArea.set(row.area_id, []);
    byArea.get(row.area_id).push(row);
  }

  const payload = areaIds.map((id) => {
    const slots = byArea.get(id) || [];
    const color = colorForSlots(slots);
    return {
      area_id: id,
      slots: [
        { slot: 1, taken: !!slots.find(s => s.slot === 1), status: slots.find(s => s.slot === 1)?.status || null, owner_business_id: slots.find(s => s.slot === 1)?.business_id || null },
        { slot: 2, taken: !!slots.find(s => s.slot === 2), status: slots.find(s => s.slot === 2)?.status || null, owner_business_id: slots.find(s => s.slot === 2)?.business_id || null },
        { slot: 3, taken: !!slots.find(s => s.slot === 3), status: slots.find(s => s.slot === 3)?.status || null, owner_business_id: slots.find(s => s.slot === 3)?.business_id || null },
      ],
      paint: color,   // {tier, fill, stroke}
    };
  });

  return json({ areas: payload });
};
