// netlify/functions/sponsored-purchase.js
import { createClient } from "@supabase/supabase-js";

// Simple pricing config (tweak to your liking)
const RATE_PER_KM2_PER_MONTH = Number(process.env.RATE_PER_KM2_PER_MONTH || 15); // £/km²/month
const MIN_PRICE_PER_MONTH = Number(process.env.MIN_PRICE_PER_MONTH || 5);        // £/month

export default async (req) => {
  // CORS (so you can call from your site)
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const auth = req.headers.get("authorization") || "";
    const { cleanerId, name, drawnGeoJSON, slot = 1, months = 1, startsAt, endsAt } = await req.json();

    if (!cleanerId || !drawnGeoJSON) {
      return json({ error: "cleanerId and drawnGeoJSON are required" }, 400);
    }
    if (![1, 2, 3].includes(Number(slot))) {
      return json({ error: "slot must be 1, 2, or 3" }, 400);
    }

    // Supabase client with the user's JWT forwarded so RLS applies
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: auth } } }
    );

    // 1) Sanity: ensure the caller owns this cleanerId (RLS will also protect us)
    const { data: meCleaner, error: meErr } = await supabase
      .from("cleaners")
      .select("id,user_id")
      .eq("id", cleanerId)
      .maybeSingle();
    if (meErr) throw meErr;
    if (!meCleaner) return json({ error: "Cleaner not found or not yours" }, 403);

    if (Number(slot) !== 1) {
      // For now we implement slot #1 only; extend later if needed
      return json({ error: "Only slot #1 purchasing is enabled right now." }, 400);
    }

    // 2) Clip the drawn polygon to what's truly available and save as a service_areas row
    const { data: clipRows, error: clipErr } = await supabase.rpc(
      "clip_available_slot1_and_make_area",
      { p_cleaner: cleanerId, p_geojson: drawnGeoJSON, p_name: name || "Sponsored area" }
    );
    if (clipErr) throw clipErr;

    // If nothing billable (e.g., fully overlapped someone else's #1)
    if (!clipRows || clipRows.length === 0) {
      return json({ error: "Selected area is not available for #1 (fully overlapped)." }, 400);
    }

    const { area_id, area_m2, final_geojson } = clipRows[0];
    const area_km2 = area_m2 / 1_000_000;

    // 3) Price calculation
    const base = area_km2 * RATE_PER_KM2_PER_MONTH;
    const monthly = Math.max(base, MIN_PRICE_PER_MONTH);
    const total = monthly * Math.max(1, Number(months));

    // 4) Dates
    const nowIso = new Date().toISOString();
    let endsIso = endsAt || null;
    if (!endsIso) {
      const d = new Date();
      d.setMonth(d.getMonth() + Math.max(1, Number(months)));
      endsIso = d.toISOString();
    }
    const startsIso = startsAt || nowIso;

    // 5) Create the sponsorship row (slot #1)
    const { data: inserted, error: insErr } = await supabase
      .from("sponsorships")
      .insert({
        cleaner_id: cleanerId,
        area_id: area_id,
        slot: 1,
        starts_at: startsIso,
        ends_at: endsIso,
        is_active: true,
        priority: 0
      })
      .select("id")
      .single();

    if (insErr) throw insErr;

    // 6) (Optional) start a Stripe Checkout session here and only activate after success.
    // For MVP we mark active immediately.

    return json({
      ok: true,
      sponsorship_id: inserted.id,
      area_id,
      area_km2: Number(area_km2.toFixed(5)),
      monthly_price: Number(monthly.toFixed(2)),
      total_price: Number(total.toFixed(2)),
      final_geojson
    });
  } catch (e) {
    console.error(e);
    return json({ error: e.message || "Failed to purchase spot" }, 500);
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
