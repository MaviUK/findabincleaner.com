// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" });
  }

  const areaIds = Array.isArray(body?.areaIds) ? body.areaIds.filter(Boolean) : [];
  if (!areaIds.length) return json({ ok: true, areas: [] });

  try {
    // 1️⃣ Load slots and pricing data
    const { data: subs, error: subErr } = await sb
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id")
      .in("area_id", areaIds);

    if (subErr) throw subErr;

    // 2️⃣ Load per-slot pricing (these can live in a simple config table)
    const { data: pricing, error: priceErr } = await sb
      .from("sponsor_slot_prices")
      .select("slot, price_per_km2");
    if (priceErr) throw priceErr;

    const priceMap = Object.fromEntries(
      (pricing || []).map((r) => [r.slot, r.price_per_km2])
    );

    // 3️⃣ Build normalized map
    const areas = [];
    for (const areaId of areaIds) {
      const relevant = subs.filter((r) => r.area_id === areaId);
      const slots = [1, 2, 3].map((n) => {
        const r = relevant.find((x) => x.slot === n);
        return {
          slot: n,
          taken: !!r,
          status: r?.status ?? null,
          owner_business_id: r?.business_id ?? null,
          price_per_km2: priceMap[n] ?? 0,
        };
      });

      // Optional: slot colours
      const paint = {
        1: { fill: "rgba(255,215,0,0.35)", stroke: "#B8860B" }, // gold
        2: { fill: "rgba(192,192,192,0.35)", stroke: "#708090" }, // silver
        3: { fill: "rgba(205,127,50,0.35)", stroke: "#8B5A2B" }, // bronze
      }[1]; // default paint (slot 1 colour)

      areas.push({ area_id: areaId, slots, paint });
    }

    return json({ ok: true, areas });
  } catch (e) {
    console.error("area-sponsorship failed:", e);
    return json({ ok: false, error: e?.message || "Server error" });
  }
};
