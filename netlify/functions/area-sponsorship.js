// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// statuses that block purchase
const BLOCKING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

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
    // Pull all rows for these areas/slots (we will select the most-recent BLOCKING row if present)
    const { data: rows, error } = await supabase
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id, created_at")
      .in("area_id", areaIds);

    if (error) throw error;

    // Build response:
    // For each (area, slot): if there exists ANY row with blocking status,
    // choose the most recent of those; otherwise choose the most recent row overall.
    const byAreaSlot = new Map(); // key = `${area}:${slot}` -> array of rows
    for (const r of rows || []) {
      const k = `${r.area_id}:${r.slot}`;
      if (!byAreaSlot.has(k)) byAreaSlot.set(k, []);
      byAreaSlot.get(k).push(r);
    }

    const byArea = new Map();
    for (const areaId of areaIds) {
      byArea.set(areaId, { area_id: areaId, slots: [] });
    }

    for (const [key, arr] of byAreaSlot.entries()) {
      arr.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const [areaId, slotStr] = key.split(":");
      const slot = Number(slotStr);

      // pick most recent BLOCKING row if any
      const blocking = arr.find((r) => BLOCKING.has(String(r.status || "").toLowerCase()));
      const chosen = blocking ?? arr[0];

      const taken = !!chosen && BLOCKING.has(String(chosen.status || "").toLowerCase());
      const area = byArea.get(areaId);
      if (!area) continue;

      area.slots.push({
        slot,
        taken,
        status: chosen?.status ?? null,
        owner_business_id: chosen?.business_id ?? null,
      });
    }

    // Ensure we have 3 slots (or 1 if you’ve already consolidated to single-slot) in the reply
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
      area.slots.sort((a, b) => a.slot - b.slot);
    }

    return json({ areas: Array.from(byArea.values()) });
  } catch (err) {
    console.error("area-sponsorship fatal error:", err);
    return json({ error: "Internal Server Error" }, 500);
  }
};
