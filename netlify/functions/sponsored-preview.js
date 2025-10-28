// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Safe env number reader
function envNumber(name, fallback = null) {
  const raw = process.env[name];
  const n = raw == null ? NaN : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const { businessId, areaId, slot } = body ?? {};
  if (!businessId || !areaId || !slot) return json({ ok: false, error: "Missing params" }, 400);

  // Read rates once
  const RATES = {
    1: envNumber("RATE_GOLD_PER_KM2_PER_MONTH"),
    2: envNumber("RATE_SILVER_PER_KM2_PER_MONTH"),
    3: envNumber("RATE_BRONZE_PER_KM2_PER_MONTH"),
  };

  // Fail fast with a clear message if any rate is not configured
  if (!Number.isFinite(RATES[1]) || !Number.isFinite(RATES[2]) || !Number.isFinite(RATES[3])) {
    return json({
      ok: false,
      error: "Pricing rates not configured. Set RATE_GOLD_PER_KM2_PER_MONTH, RATE_SILVER_PER_KM2_PER_MONTH, and RATE_BRONZE_PER_KM2_PER_MONTH in Netlify env.",
    }, 500);
  }

  try {
    // ...your geometry work to compute purchaseable area for this slot...
    // Assume you compute area_km2 as a Number > 0
    const area_km2 = /* your computed value */ null;

    if (!Number.isFinite(area_km2)) {
      return json({ ok: false, error: "Geometry operation failed" }, 400);
    }

    const ratePerKm2 = RATES[slot] ?? 0;
    const monthly_price_cents = Math.round(area_km2 * ratePerKm2 * 100);

    return json({
      ok: true,
      slot,
      area_km2,
      rate_per_km2_per_month: ratePerKm2,         // for transparency
      monthly_price_cents,
      monthly_price_display: (monthly_price_cents / 100).toFixed(2),
      // preview_geojson: <your preview geometry if you return it>
    });
  } catch (err) {
    console.error("sponsored-preview error:", err);
    return json({ ok: false, error: "Server error" }, 500);
  }
};
