// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const areaId = String(body.areaId || "").trim();
  const businessId = String(body.businessId || body.cleanerId || "").trim();
  const slot = Number(body.slot ?? 1);

  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);
  if (!Number.isFinite(slot) || slot < 1) return json({ ok: false, error: "Invalid slot" }, 400);

  try {
    // 1) If someone else already owns the slot, short-circuit (sold out).
    const { data: taken, error: takenErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id,status")
      .eq("area_id", areaId)
      .eq("slot", slot)
      .order("created_at", { ascending: false })
      .limit(1);

    if (takenErr) throw takenErr;

    if (Array.isArray(taken) && taken.length > 0) {
      const row = taken[0];
      const status = String(row.status || "").toLowerCase();
      if (BLOCKING.has(status) && row.business_id !== businessId) {
        // Sold out due to another business
        return json({
          ok: false,
          error: "No purchasable area left for this slot.",
          area_km2: 0,
        });
      }
    }

    // 2) Ask DB what sub-geometry remains for this slot (your RPC does the heavy lifting)
    const { data, error } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;

    const area_km2 = Number(row?.area_km2 ?? 0) || 0;
    const geojson = row?.gj ?? null;

    // 3) Total area of the Service Area (for “coverage”)
    let total_km2 = null;
    const { data: sa, error: saErr } = await sb
      .from("service_areas")
      .select("gj")
      .eq("id", areaId)
      .maybeSingle();
    if (!saErr && sa?.gj) {
      try {
        // Compute quickly without turf: the RPC might already send total;
        // otherwise leave null; UI handles null gracefully.
        total_km2 = row?.total_km2 ?? null;
      } catch {
        total_km2 = null;
      }
    }

    // 4) Rates (from env)
    const rateMap = {
      1: Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 1),
      2: Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 1),
      3: Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 1),
    };
    const rate_per_km2 = Number.isFinite(rateMap[slot]) ? rateMap[slot] : 1;

    const floorMap = {
      1: Number(process.env.MIN_GOLD_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 1),
      2: Number(process.env.MIN_SILVER_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 1),
      3: Number(process.env.MIN_BRONZE_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 1),
    };
    const floor_monthly = Number.isFinite(floorMap[slot]) ? floorMap[slot] : 1;

    return json({
      ok: true,
      area_km2,
      total_km2,
      rate_per_km2,
      floor_monthly,
      unit_currency: "GBP",
      geojson,
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error", area_km2: 0 }, 200);
  }
};
