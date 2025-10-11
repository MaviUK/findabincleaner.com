import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const COLORS = {
  gold:   { fill: "rgba(255,215,0,0.35)",  stroke: "#B8860B" },
  silver: { fill: "rgba(192,192,192,0.35)", stroke: "#708090" },
  bronze: { fill: "rgba(205,127,50,0.35)",  stroke: "#8B5A2B" },
  none:   { fill: "rgba(0,0,0,0)",          stroke: "#555" },
};

function colorForSlots(slots) {
  const ok = (s) => s && (s.status === "active" || s.status === "past_due");
  const has1 = slots.some((s) => s.slot === 1 && ok(s));
  const has2 = slots.some((s) => s.slot === 2 && ok(s));
  const has3 = slots.some((s) => s.slot === 3 && ok(s));
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
  let areaIds = [];
  try {
    const payload = await req.json();
    areaIds = Array.isArray(payload.areaIds) ? payload.areaIds : [];
  } catch {}
  if (!areaIds.length) return json({ areas: [] });

  const { data, error } = await supabase
    .from("v_area_slot_status")
    .select("area_id, slot, status, business_id")
    .in("area_id", areaIds);

  if (error) return json({ error: error.message }, 500);

  const byArea = new Map();
  for (const row of data || []) {
    if (!byArea.has(row.area_id)) byArea.set(row.area_id, []);
    byArea.get(row.area_id).push(row);
  }

  const payload = areaIds.map((id) => {
    const slots = (byArea.get(id) || []).map((r) => ({
      slot: r.slot,
      taken: true,
      status: r.status,
      owner_business_id: r.business_id,
    }));
    const color = colorForSlots(slots);
    function get(slot) {
      return slots.find((s) => s.slot === slot) || { slot, taken: false, status: null, owner_business_id: null };
    }
    return {
      area_id: id,
      slots: [get(1), get(2), get(3)],
      paint: color,
    };
  });

  return json({ areas: payload });
};
