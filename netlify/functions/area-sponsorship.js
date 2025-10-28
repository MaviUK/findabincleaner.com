// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// statuses that block a slot
const BLOCKING = ["active", "trialing", "past_due", "unpaid", "incomplete"];

export default async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const areaIds = Array.isArray(body?.areaIds) ? body.areaIds.filter(Boolean) : [];
    if (!areaIds.length) return json({ areas: [] });

    // 1) Remaining geometry per slot (from the view)
    const { data: remain, error: rErr } = await sb
      .from("v_area_slot_remaining")
      .select("area_id, slot, remaining_km2, total_km2, sold_out")
      .in("area_id", areaIds)
      .order("area_id", { ascending: true })
      .order("slot", { ascending: true });

    if (rErr) {
      console.error("area-sponsorship remain error:", rErr);
      return json({ error: "Database error (remaining)" }, 500);
    }

    // 2) Active/taken subscriptions per slot (ownership)
    const { data: subs, error: sErr } = await sb
      .from("sponsored_subscriptions")
      .select("area_id, slot, business_id, status")
      .in("area_id", areaIds)
      .in("status", BLOCKING);

    if (sErr) {
      console.error("area-sponsorship subs error:", sErr);
      return json({ error: "Database error (subscriptions)" }, 500);
    }

    // Index ownership by (area_id, slot)
    const owned = new Map();
    for (const row of subs || []) {
      const key = `${row.area_id}:${row.slot}`;
      // if multiple, prefer any blocking one (they all are) – keep the first
      if (!owned.has(key)) owned.set(key, row);
    }

    // Build response grouped by area
    const byArea = new Map();
    for (const r of remain || []) {
      const key = r.area_id;
      if (!byArea.has(key)) byArea.set(key, { area_id: key, slots: [] });

      const o = owned.get(`${r.area_id}:${r.slot}`);
      byArea.get(key).slots.push({
        slot: r.slot,
        // geometry metrics
        remaining_km2: typeof r.remaining_km2 === "number" ? r.remaining_km2 : Number(r.remaining_km2),
        total_km2: typeof r.total_km2 === "number" ? r.total_km2 : Number(r.total_km2),
        sold_out: !!r.sold_out,
        // ownership
        taken: !!o,
        status: o?.status ?? null,
        owner_business_id: o?.business_id ?? null,
      });
    }

    // Ensure all three slots exist in the response, even if view returns fewer rows
    for (const area_id of areaIds) {
      if (!byArea.has(area_id)) byArea.set(area_id, { area_id, slots: [] });
      const area = byArea.get(area_id);
      const present = new Set(area.slots.map((s) => s.slot));
      for (const s of [1, 2, 3]) {
        if (!present.has(s)) {
          const o = owned.get(`${area_id}:${s}`);
          area.slots.push({
            slot: s,
            remaining_km2: null,
            total_km2: null,
            sold_out: false,
            taken: !!o,
            status: o?.status ?? null,
            owner_business_id: o?.business_id ?? null,
          });
        }
      }
      // keep slot order
      area.slots.sort((a, b) => a.slot - b.slot);
    }

    return json({ areas: Array.from(byArea.values()) }, 200);
  } catch (err) {
    console.error("area-sponsorship fatal error:", err);
    return json({ error: "Internal Server Error" }, 500);
  }
};
