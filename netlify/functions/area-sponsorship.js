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
    return json({ areas: [] });
  }

  const areaIds = Array.isArray(body?.areaIds) ? body.areaIds.filter(Boolean) : [];
  if (!areaIds.length) return json({ areas: [] });

  try {
    const { data, error } = await sb
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id")
      .in("area_id", areaIds);

    if (error) throw error;

    const byArea = new Map();
    for (const id of areaIds) byArea.set(id, { area_id: id, slots: [] });

    for (const id of areaIds) {
      const rows = (data || []).filter((r) => r.area_id === id);
      const slots = [1, 2, 3].map((n) => {
        const r = rows.find((x) => x.slot === n) || null;
        return {
          slot: n,
          taken: !!r,
          status: r?.status ?? null,
          owner_business_id: r?.business_id ?? null,
        };
      });
      byArea.set(id, { area_id: id, slots });
    }

    return json({ areas: Array.from(byArea.values()) });
  } catch (e) {
    // Fail quietly so the UI doesn’t crash
    return json({ areas: [] });
  }
};
