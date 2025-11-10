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

// Only real, usable subscriptions should block.
// Drop 'incomplete' and 'unpaid' to avoid false occupancy from abandoned checkouts.
const BLOCKING = new Set(["active", "trialing", "past_due"]);

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const areaIds =
    Array.isArray(body?.areaIds) && body.areaIds.length
      ? body.areaIds.filter(Boolean)
      : Array.isArray(body?.area_ids)
      ? body.area_ids.filter(Boolean)
      : [];

  if (!areaIds.length) return json({ areas: [] });

  try {
    const { data: subs, error } = await supabase
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id, created_at")
      .in("area_id", areaIds);

    if (error) throw error;

    const byArea = new Map(areaIds.map((id) => [id, []]));
    for (const row of subs || []) {
      const arr = byArea.get(row.area_id);
      if (arr) arr.push(row);
    }

    const areas = areaIds.map((area_id) => {
      const rows = byArea.get(area_id) || [];

      let latestBlocking = null;
      for (const r of rows) {
        const isBlock = BLOCKING.has(String(r.status || "").toLowerCase());
        if (isBlock) {
          if (
            !latestBlocking ||
            new Date(r.created_at).getTime() > new Date(latestBlocking.created_at).getTime()
          ) {
            latestBlocking = r;
          }
        }
      }

      const taken = !!latestBlocking;
      const status = latestBlocking?.status ?? null;
      const owner_business_id = latestBlocking?.business_id ?? null;

      // Back-compat: also return slots[] with slot=1 only
      const slots = [
        {
          slot: 1,
          taken,
          status,
          owner_business_id,
        },
      ];

      return { area_id, taken, status, owner_business_id, slots };
    });

    return json({ areas }, 200);
  } catch (err) {
    console.error("area-sponsorship fatal error:", err);
    return json({ error: "Internal Server Error" }, 500);
  }
};
