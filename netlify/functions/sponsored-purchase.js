// netlify/functions/sponsored-purchase.js
import { createClient } from "@supabase/supabase-js";

/**
 * Simple pricing config (env overrides allowed)
 * - RATE_PER_KM2_PER_MONTH: £/km²/month
 * - MIN_PRICE_PER_MONTH:    £/month minimum
 */
const RATE_PER_KM2_PER_MONTH = Number(process.env.RATE_PER_KM2_PER_MONTH ?? 15);
const MIN_PRICE_PER_MONTH    = Number(process.env.MIN_PRICE_PER_MONTH ?? 5);

/** JSON helper (with permissive CORS for your SPA) */
function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}

/** Add N months in UTC without DST weirdness */
function addMonthsUTC(date, n) {
  const d = new Date(date);
  const m = d.getUTCMonth() + n;
  d.setUTCMonth(m);
  return d;
}

export default async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const auth = req.headers.get("authorization") || "";

    const {
      cleanerId,
      name,
      drawnGeoJSON,
      slot = 1,              // currently we only allow slot #1
      months = 1,            // initial duration
      startsAt,              // optional ISO
      endsAt                 // optional ISO
    } = await req.json();

    // ---------- Validation ----------
    if (!cleanerId) return json({ error: "cleanerId is required" }, 400);
    if (!drawnGeoJSON) return json({ error: "drawnGeoJSON is required" }, 400);

    const slotNum = Number(slot);
    if (![1, 2, 3].includes(slotNum)) {
      return json({ error: "slot must be 1, 2, or 3" }, 400);
    }
    if (slotNum !== 1) {
      // Keep behavior consistent with the rest of your app for now.
      return json({ error: "Only slot #1 purchasing is enabled right now." }, 400);
    }

    const monthsInt = Math.max(1, Number(months) || 1);

    // ---------- Supabase client (user context so RLS applies) ----------
    const supabase = createClient(
      process.env.SUPABASE_URL,
      // IMPORTANT: for browser-originating calls we use anon key, not service role
      process.env.VITE_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: auth } } }
    );

    // 1) Caller owns this cleaner (RLS re-checks on writes anyway)
    const { data: meCleaner, error: meErr } = await supabase
      .from("cleaners")
      .select("id,user_id")
      .eq("id", cleanerId)
      .maybeSingle();
    if (meErr) throw meErr;
    if (!meCleaner) return json({ error: "Cleaner not found or not yours" }, 403);

    // 2) Prevent duplicate active purchase of slot #1 for this cleaner
    //    If your business rule is "one active slot #1 sponsorship per cleaner", block here.
    const nowIso = new Date().toISOString();
    const { data: existingActive, error: existingErr } = await supabase
      .from("sponsorships")
      .select("id, ends_at, is_active")
      .eq("cleaner_id", cleanerId)
      .eq("slot", 1)
      .eq("is_active", true)
      .gt("ends_at", nowIso);
    if (existingErr) throw existingErr;

    if (existingActive && existingActive.length > 0) {
      return json(
        {
          error:
            "You already have an active Slot #1 sponsorship. Let it expire or cancel before purchasing again.",
        },
        409
      );
    }

    // 3) Clip User-drawn geometry to what's truly available for Slot #1 and create a service_areas row
    const { data: clipRows, error: clipErr } = await supabase.rpc(
      "clip_available_slot1_and_make_area",
      {
        p_cleaner: cleanerId,
        p_geojson: drawnGeoJSON,
        p_name: name || "Sponsored area",
      }
    );
    if (clipErr) throw clipErr;

    // If nothing billable (e.g., fully overlapped someone else's #1)
    if (!clipRows || clipRows.length === 0) {
      return json(
        { error: "Selected area is not available for #1 (it's fully overlapped)." },
        400
      );
    }

    const { area_id, area_m2, final_geojson } = clipRows[0];

    // 4) Price calculation
    const area_km2 = (Number(area_m2) || 0) / 1_000_000;
    const monthlyPrice = Math.max(
      MIN_PRICE_PER_MONTH,
      Math.max(0, area_km2) * RATE_PER_KM2_PER_MONTH
    );
    const totalPrice = monthlyPrice * monthsInt;

    // 5) Dates
    const start = startsAt ? new Date(startsAt) : new Date();
    const end   = endsAt ? new Date(endsAt) : addMonthsUTC(start, monthsInt);

    const startsIso = start.toISOString();
    const endsIso   = end.toISOString();

    // 6) Create the sponsorship row immediately (no Stripe here)
    const { data: inserted, error: insErr } = await supabase
      .from("sponsorships")
      .insert({
        cleaner_id: cleanerId,
        area_id: area_id,
        slot: 1,
        starts_at: startsIso,
        ends_at: endsIso,
        is_active: true,
        priority: 0, // adjust if you later support priority ordering
        // If you later add columns such as price/month, store them here too:
        // price_monthly_pennies: Math.round(monthlyPrice * 100),
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    // 7) Respond with full context for the UI
    return json({
      ok: true,
      sponsorship_id: inserted.id,
      area_id,
      area_km2: Number(area_km2.toFixed(5)),
      monthly_price: Number(monthlyPrice.toFixed(2)),
      total_price: Number(totalPrice.toFixed(2)),
      starts_at: startsIso,
      ends_at: endsIso,
      final_geojson,
    });
  } catch (e) {
    console.error("[sponsored-purchase] error:", e);
    const message =
      typeof e?.message === "string" && e.message.startsWith("<")
        ? "Server returned HTML (check Netlify redirects order)."
        : e?.message || "Failed to purchase spot";
    return json({ error: message }, 500);
  }
};
