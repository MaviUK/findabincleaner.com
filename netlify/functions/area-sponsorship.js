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
    // pull latest subscriptions for the areas
    const { data, error } = await sb
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id")
      .in("area_id", areaIds);

    if (error) throw error;

    // build a per-area 3-slot status + paint (colors for overlay are your choice)
    const byArea = new Map(areaIds.map((id) => [id, {
      area_id: id,
      slots: [
        { slot: 1, taken: false, status: null, owner_business_id: null },
        { slot: 2, taken: false, status: null, owner_business_id: null },
        { slot: 3, taken: false, status: null, owner_business_id: null },
      ],
      paint: { tier: 0, fill: "rgba(0,0,0,0.0)", stroke: "#555" },
    }]));

    const ACTIVE = new Set(["active","trialing","past_due","unpaid","incomplete","incomplete_expired"]);

    for (const row of data || []) {
      const entry = byArea.get(row.area_id);
      if (!entry) continue;
      const slotIdx = Number(row.slot) - 1;
      if (slotIdx < 0 || slotIdx > 2) continue;

      const isTaken = ACTIVE.has(row.status);
      entry.slots[slotIdx] = {
        slot: Number(row.slot),
        taken: isTaken,
        status: row.status || null,
        owner_business_id: row.business_id || null,
      };
    }

    // choose a paint tier for the area (highest taken slot)
    for (const entry of byArea.values()) {
      let tier = 0;
      if (entry.slots[0].taken) tier = Math.max(tier, 1);
      if (entry.slots[1].taken) tier = Math.max(tier, 2);
      if (entry.slots[2].taken) tier = Math.max(tier, 3);

      if (tier === 1) entry.paint = { tier, fill: "rgba(255,215,0,0.35)", stroke: "#B8860B" };   // Gold
      else if (tier === 2) entry.paint = { tier, fill: "rgba(192,192,192,0.35)", stroke: "#708090" }; // Silver
      else if (tier === 3) entry.paint = { tier, fill: "rgba(205,127,50,0.35)", stroke: "#8B5A2B" };  // Bronze
      else entry.paint = { tier: 0, fill: "rgba(0,0,0,0.0)", stroke: "#555" };
    }

    return json({ areas: Array.from(byArea.values()) });
  } catch (e) {
    console.error("[area-sponsorship] error:", e);
    return json({ error: "DB error" }, 500);
  }
};
