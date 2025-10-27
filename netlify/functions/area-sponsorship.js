// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Only these statuses block a slot (matches your UI logic)
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

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
    // who owns which slots?
    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id")
      .in("area_id", areaIds);

    if (subsErr) throw subsErr;

    // how much area remains (per slot)?
    const { data: remaining, error: remErr } = await sb
      .from("v_area_slot_remaining")
      .select("area_id, slot, remaining_km2, sold_out")
      .in("area_id", areaIds);

    if (remErr) throw remErr;

    // index helpers
    const subsByArea = new Map();
    for (const s of subs || []) {
      if (!subsByArea.has(s.area_id)) subsByArea.set(s.area_id, []);
      subsByArea.get(s.area_id).push(s);
    }

    const remByArea = new Map();
    for (const r of (remaining || [])) {
      if (!remByArea.has(r.area_id)) remByArea.set(r.area_id, new Map());
      remByArea.get(r.area_id).set(r.slot, r);
    }

    const areas = areaIds.map((area_id) => {
      const sList = subsByArea.get(area_id) || [];
      const rMap = remByArea.get(area_id) || new Map();

      const slots = [1, 2, 3].map((slot) => {
        const sub = sList.find((x) => x.slot === slot) || null;
        const r = rMap.get(slot) || null;

        const status = sub?.status ?? null;
        const taken = status ? BLOCKING.has(String(status).toLowerCase()) : false;

        return {
          slot,
          taken,
          status,
          owner_business_id: sub?.business_id ?? null, // what your UI checks against
          remaining_km2:
            r?.remaining_km2 == null
              ? null
              : typeof r.remaining_km2 === "number"
              ? r.remaining_km2
              : Number(r.remaining_km2),
          sold_out: r?.sold_out ?? null,
        };
      });

      return { area_id, slots };
    });

    return json({ areas }, 200);
  } catch (err) {
    console.error("area-sponsorship error:", err);
    return json({ error: "Internal Server Error" }, 500);
  }
};
