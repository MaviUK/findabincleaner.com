// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ... rate/min helpers are unchanged ...

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const cleanerId = body?.cleanerId || body?.businessId || null; // <- accept either (optional)
    const areaId    = body?.areaId;
    const slot      = Number(body?.slot);

    if (!areaId || !slot) {
      return json({ ok: false, error: "Missing params" }, 400);  // only require what we use
    }

    // call your RPC exactly as before
    const { data, error } = await sb.rpc("get_area_preview", {
      _area_id: areaId,
      _slot: slot,
      _drawn_geojson: null,
      _exclude_cleaner: null, // could pass cleanerId if you later need it
    });
    if (error) {
      console.error("[sponsored-preview] get_area_preview error:", error);
      return json({ ok: false, error: "Failed to compute area" }, 200);
    }

    const row = Array.isArray(data) ? data[0] : data;
    const area_km2 = Number(row?.area_km2 ?? 0);
    const final_geojson = row?.final_geojson ?? null;

    // pricing
    const RATE_DEFAULT = Number(process.env.RATE_PER_KM2_PER_MONTH ?? 15);
    const MIN_DEFAULT  = Number(process.env.MIN_PRICE_PER_MONTH ?? 1);
    const RATE_TIER = {
      1: Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? RATE_DEFAULT),
      2: Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH ?? RATE_DEFAULT),
      3: Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH ?? RATE_DEFAULT),
    };
    const MIN_TIER = {
      1: Number(process.env.MIN_GOLD_PRICE_PER_MONTH ?? MIN_DEFAULT),
      2: Number(process.env.MIN_SILVER_PRICE_PER_MONTH ?? MIN_DEFAULT),
      3: Number(process.env.MIN_BRONZE_PRICE_PER_MONTH ?? MIN_DEFAULT),
    };

    const rate = RATE_TIER[slot] ?? RATE_DEFAULT;
    const min  = MIN_TIER[slot]  ?? MIN_DEFAULT;
    const monthly = Math.max(min, Math.max(0, area_km2) * rate);

    return json({
      ok: true,
      area_km2: Number.isFinite(area_km2) ? Number(area_km2.toFixed(6)) : 0,
      monthly_price: Number(monthly.toFixed(2)),
      final_geojson,
    });
  } catch (e) {
    console.error("[sponsored-preview] fatal:", e);
    return json({ ok: false, error: "Preview failed" }, 200);
  }
};
