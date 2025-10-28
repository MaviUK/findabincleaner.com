// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// JSON helper
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// statuses that *block* the slot from being purchased by others
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

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
    // Pull ALL subs for these areas; we’ll keep the most recent per (area_id, slot)
    const { data: subs, error } = await supabase
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id, created_at")
      .in("area_id", areaIds);

    if (error) throw error;

    // Keep the latest sub per (area_id, slot)
    const latest = new Map(); // key = `${area_id}:${slot}`
    for (const row of subs || []) {
      const key = `${row.area_id}:${row.slot}`;
      const prev = latest.get(key);
      if (!prev || new Date(row.created_at) > new Date(prev.created_at)) {
        latest.set(key, row);
      }
    }

    // Shape response the UI expects
    //   { areas: [{ area_id, slots: [{slot, taken, status, owner_business_id}], paint? }] }
    const byArea = new Map();
    for (const areaId of areaIds) {
      byArea.set(areaId, { area_id: areaId, slots: [] });
    }

    for (const [key, row] of latest.entries()) {
      const areaId = row.area_id;
      const area = byArea.get(areaId);
      if (!area) continue;

      area.slots.push({
        slot: row.slot,
        taken: BLOCKING.has(String(row.status || "").toLowerCase()),
        status: row.status ?? null,
        owner_business_id: row.business_id ?? null,
      });
    }

    // Ensure all three slots are present (so UI can show “Sponsor #n” for missing ones)
    for (const area of byArea.values()) {
      const present = new Set(area.slots.map((s) => s.slot));
      for (const s of [1, 2, 3]) {
        if (!present.has(s)) {
          area.slots.push({
            slot: s,
            taken: false,
            status: null,
            owner_business_id: null,
          });
        }
      }
      // stable ordering
      area.slots.sort((a, b) => a.slot - b.slot);
    }

    return json({ areas: Array.from(byArea.values()) }, 200);
  } catch (err) {
    console.error("area-sponsorship fatal error:", err);
    return json({ error: "Internal Server Error" }, 500);
  }
};
