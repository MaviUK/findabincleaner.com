// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Statuses that mean the slot is considered "taken"
const BLOCKING = ["active", "trialing", "past_due", "unpaid", "incomplete"];

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
    // Pull *all* subs for these areas (we'll pick the latest per slot below)
    const { data, error } = await sb
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id, created_at")
      .in("area_id", areaIds)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const byArea = new Map();
    for (const row of data || []) {
      const area_id = row.area_id;
      if (!byArea.has(area_id)) byArea.set(area_id, []);
      byArea.get(area_id).push(row);
    }

    const areas = areaIds.map((area_id) => {
      const rows = (byArea.get(area_id) || []).filter((r) =>
        BLOCKING.includes((r.status || "").toLowerCase())
      );

      // pick the *latest* blocking record per slot
      const latestBySlot = new Map(); // slot -> row
      for (const r of rows) {
        if (!latestBySlot.has(r.slot)) latestBySlot.set(r.slot, r);
      }

      const slots = [1, 2, 3].map((n) => {
        const r = latestBySlot.get(n);
        return {
          slot: n,
          taken: !!r,
          status: r?.status ?? null,
          owner_business_id: r?.business_id ?? null,
        };
      });

      // paint is optional; leave undefined or set separately if you color-fill on the map
      return { area_id, slots, paint: undefined };
    });

    return json({ areas });
  } catch (e) {
    return json({ error: e.message || "Server error" }, 500);
  }
};
