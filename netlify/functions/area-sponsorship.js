// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

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

    // Pull the most-recent subs per area & slot
    const { data, error } = await sb
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id, created_at")
      .in("area_id", areaIds)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Build map: area_id -> slot -> latest row
    const latest = new Map(); // key: `${area_id}:${slot}` -> row
    for (const row of data || []) {
      const key = `${row.area_id}:${row.slot}`;
      if (!latest.has(key)) latest.set(key, row);
    }

    // Compose response per area with independent tiers
    const areas = areaIds.map((area_id) => {
      const slots = [1, 2, 3].map((slot) => {
        const row = latest.get(`${area_id}:${slot}`) || null;
        const status = (row?.status || "").toLowerCase() || null;
        const taken = row ? BLOCKING.has(status) : false;
        return {
          slot,
          taken,
          status,
          owner_business_id: row?.business_id ?? null,
        };
      });

      // Optional “paint” is purely cosmetic; keep neutral/default colors if you prefer
      const paint = { tier: 0, fill: "rgba(0,0,0,0)", stroke: "#555" };

      return { area_id, slots, paint };
    });

    return json({ areas });
  } catch (e) {
    console.error("[area-sponsorship] error:", e);
    return json({ error: "Server error" }, 200); // Return 200 with error payload so UI doesn't crash
  }
}
