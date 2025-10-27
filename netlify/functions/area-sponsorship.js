// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// which subscription statuses should block a slot
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Parse body
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const areaIds = Array.isArray(body?.areaIds) ? body.areaIds.filter(Boolean) : [];
  if (!areaIds.length) return json({ areas: [] });

  try {
    // 1) Who owns each slot?
    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id")
      .in("area_id", areaIds);

    if (subsErr) throw subsErr;

    // 2) Remaining area per slot (from your materialized logic/view)
    const { data: remaining, error: remErr } = await sb
      .from("v_area_slot_remaining")
      .select("area_id, slot, remaining_km2, sold_out")
      .in("area_id", areaIds);

    if (remErr) throw remErr;

    // Index helpers
    const subsByArea = new Map();
    for (const s of subs || []) {
      if (!subsByArea.has(s.area_id)) subsByArea.set(s.area_id, []);
      subsByArea.get(s.area_id).push(s);
    }

    const remainingByArea = new Map();
    for (const r of remaining || []) {
      if (!remainingByArea.has(r.area_id)) remainingByArea.set(r.area_id, new Map());
      remainingByArea.get(r.area_id).set(r.slot, r);
    }

    // Build response
    const areas = areaIds.map((area_id) => {
      const sList = subsByArea.get(area_id) || [];
      const remMap = remainingByArea.get(area_id) || new Map();

      const slots = [1, 2, 3].map((slot) => {
        const sub = sList.find((x) => x.slot === slot) || null;
        const rem = remMap.get(slot) || null;

        return {
          slot,
          taken: !!(sub && BLOCKING.has(String(sub.status || "").toLowerCase())),
          status: sub?.status ?? null,
          owner_business_id: sub?.business_id ?? null,
          // optional extras so UI can display more if needed
          remaining_km2:
            rem?.remaining_km2 == null
              ? null
              : typeof rem.remaining_km2 === "number"
              ? rem.remaining_km2
              : Number(rem.remaining_km2),
          sold_out: rem?.sold_out ?? null,
        };
      });

      return { area_id, slots };
    });

    return json({ areas });
  } catch (err) {
    console.error("area-sponsorship error:", err);
    return json({ error: "Internal Server Error" }, 500);
  }
};
