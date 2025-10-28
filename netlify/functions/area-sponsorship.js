// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

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
    // 1) Who owns each slot right now?
    const occ = await sb
      .from("v_area_slot_occupancy")
      .select("area_id, slot, owner_business_id, owner_status, owner_until")
      .in("area_id", areaIds);

    if (occ.error) throw occ.error;

    // 2) Shape for UI: one object per area with 3 slots
    const byArea = new Map();
    for (const id of areaIds) {
      byArea.set(id, {
        area_id: id,
        slots: [
          { slot: 1, taken: false, status: null, owner_business_id: null },
          { slot: 2, taken: false, status: null, owner_business_id: null },
          { slot: 3, taken: false, status: null, owner_business_id: null },
        ],
        // optional paint kept as-is / not used for blocking
        paint: undefined,
      });
    }

    const isBlocking = (s) =>
      [
        "active",
        "trialing",
        "past_due",
        "unpaid",
        "incomplete",
        "processing",
        "complete",
        "paid",
        "succeeded",
      ].includes(String(s || "").toLowerCase());

    for (const row of occ.data || []) {
      const a = byArea.get(row.area_id);
      if (!a) continue;
      const idx = Number(row.slot) - 1;
      if (idx < 0 || idx > 2) continue;

      const taken = isBlocking(row.owner_status) && row.owner_until && new Date(row.owner_until) > new Date();
      a.slots[idx]()
