import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// Hard-blocking statuses per spec
const HARD_BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);
const HOLD_MINUTES = Number(process.env.INCOMPLETE_HOLD_MINUTES || 35);

function isBlockingRow(row) {
  const s = String(row?.status || "").toLowerCase();
  if (HARD_BLOCKING.has(s)) return true;
  if (s === "incomplete") {
    const ts = row?.created_at ? new Date(row.created_at).getTime() : 0;
    const ageMin = (Date.now() - ts) / 60000;
    return ageMin <= HOLD_MINUTES;
  }
  return false;
}

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
      .select("area_id, slot, status, business_id, final_geojson, created_at")
      .in("area_id", areaIds);
    if (error) throw error;

    const byArea = {};
    for (const area_id of areaIds) {
      byArea[area_id] = {
        area_id,
        slots: [1, 2, 3].map((slot) => ({
          slot,
          taken: false,
          status: null,
          owner_business_id: null,
        })),
        paint: { tier: 0, fill: "rgba(0,0,0,0.0)", stroke: "#555" },
      };
    }

    for (const row of data || []) {
      if (!byArea[row.area_id]) continue;
      if (isBlockingRow(row)) {
        const idx = [1, 2, 3].indexOf(row.slot);
        if (idx >= 0) {
          byArea[row.area_id].slots[idx] = {
            slot: row.slot,
            taken: true,
            status: row.status,
            owner_business_id: row.business_id,
          };
        }
      }
    }

    // add paint per area: if any slot is taken, color by highest tier
    for (const area_id of Object.keys(byArea)) {
      const slots = byArea[area_id].slots;
      // pick first taken slot by priority 1>2>3 for color
      const tier =
        (slots.find((s) => s.slot === 1 && s.taken) && 1) ||
        (slots.find((s) => s.slot === 2 && s.taken) && 2) ||
        (slots.find((s) => s.slot === 3 && s.taken) && 3) ||
        0;
      if (tier) {
        const color = SLOT_COLORS[tier];
        byArea[area_id].paint = {
          tier,
          fill: `${hexToRgba(color, 0.35)}`,
          stroke: darken(color),
        };
      }
    }

    return json({ areas: Object.values(byArea) });
  } catch (err) {
    console.error("area-sponsorship error:", err);
    return json({ error: "DB error" }, 500);
  }
};

// helpers for paint
function hexToRgba(hex, a) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(0,0,0,${a})`;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${a})`;
}
function darken(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return "#555";
  const r = Math.max(0, parseInt(m[1], 16) - 60);
  const g = Math.max(0, parseInt(m[2], 16) - 60);
  const b = Math.max(0, parseInt(m[3], 16) - 60);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
