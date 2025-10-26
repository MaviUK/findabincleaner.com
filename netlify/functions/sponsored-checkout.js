import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import * as turf from "@turf/turf";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Treat anything not canceled/incomplete_expired as blocking.
const NON_BLOCKING = new Set(["canceled", "incomplete_expired"]);
const isBlocking = (s) => !NON_BLOCKING.has(String(s || "").toLowerCase());

function rateForSlot(slot) {
  const base = Number(process.env.RATE_PER_KM2_PER_MONTH || 1);
  const perSlot = {
    1: Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH || base),
    2: Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH || base),
    3: Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH || base),
  };
  return perSlot[slot] || base;
}
function minForSlot(slot) {
  const base = Number(process.env.MIN_PRICE_PER_MONTH || 1);
  const perSlot = {
    1: Number(process.env.MIN_GOLD_PRICE_PER_MONTH || base),
    2: Number(process.env.MIN_SILVER_PRICE_PER_MONTH || base),
    3: Number(process.env.MIN_BRONZE_PRICE_PER_MONTH || base),
  };
  return perSlot[slot] || base;
}

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
    return json({ error: "Invalid JSON" }, 400);
  }

  const areaId = body?.areaId;
  const slot = Number(body?.slot);
  const businessId = body?.businessId;
  const previewId = body?.previewId || null;

  if (!areaId || !Number.isInteger(slot) || !businessId) {
    return json({ error: "Missing areaId, slot, or businessId" }, 400);
  }

  try {
    // ---------- STEP 0: Clear stale locks (lightweight best-effort) ----------
    try {
      await sb.rpc("cleanup_stale_sponsored_locks");
    } catch (_) {}

    // ---------- STEP 1: Hard block if any live sponsor exists ----------
    const { data: existing, error: exErr } = await sb
      .from("sponsored_subscriptions")
      .select("id, status, business_id")
      .eq("area_id", areaId)
      .eq("slot", slot);
    if (exErr) throw exErr;

    const live = (existing || []).find((r) => isBlocking(r.status));
    if (live && live.business_id !== businessId) {
      return json(
        { error: `Slot #${slot} is already sponsored by another business.` },
        409
      );
    }

    // ---------- STEP 2: Acquire a concurrency lock ----------
    // Only one lock row (area,slot) may exist due to the UNIQUE(area_id,slot).
    // If another checkout is in flight, this insert will fail.
    let lockId = null;
    {
      const { data, error } = await sb
        .from("sponsored_locks")
        .insert([{ area_id: areaId, slot, business_id: businessId }])
        .select("id")
        .single();

      if (error) {
        // 23505 => unique_violation (already locked)
        if (String(error.code) === "23505") {
          return json(
            { error: `Another checkout is already holding slot #${slot} for this area.` },
            409
          );
        }
        throw error;
      }
      lockId = data.id;
    }

    // ---------- STEP 3: Compute available geometry (subtract blockers) ----------
    const { data: areaRow, error: areaErr } = await sb
      .from("service_areas")
      .select("gj")
      .eq("id", areaId)
      .maybeSingle();
    if (areaErr) throw areaErr;
    if (!areaRow?.gj) return json({ error: "Area not found" }, 404);

    let base;
    const gj = areaRow.gj;
    if (gj.type === "Polygon") base = turf.multiPolygon([gj.coordinates]);
    else if (gj.type === "MultiPolygon") base = turf.multiPolygon(gj.coordinates);
    else return json({ error: "Area geometry must be Polygon or MultiPolygon" }, 400);

    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("status, final_geojson")
      .eq("area_id", areaId)
      .eq("slot", slot);
    if (subsErr) throw subsErr;

    let available = base;
    for (const s of subs || []) {
      if (!isBlocking(s.status)) continue;
      if (!s.final_geojson) {
        // A live winner without final_geojson blocks the entire slot
        return json({ error: "No purchasable area left for this slot." }, 400);
      }
      const g = s.final_geojson;
      let blockGeom;
      if (g.type === "Polygon") blockGeom = turf.multiPolygon([g.coordinates]);
      else if (g.type === "MultiPolygon") blockGeom = turf.multiPolygon(g.coordinates);
      else continue;

      try {
        available = turf.difference(available, blockGeom) || turf.multiPolygon([]);
      } catch (e) {
        console.error("Geometry difference failed:", e);
      }
    }

    const km2 = turf.area(available) / 1e6;
    if (km2 < 0.00001) {
      return json({ error: "No purchasable area left for this slot." }, 400);
    }

    // ---------- STEP 4: Price ----------
    const rate = rateForSlot(slot);
    const min = minForSlot(slot);
    const monthly = Math.max(km2 * rate, min);
    const unitAmount = Math.round(monthly * 100); // pence

    // ---------- STEP 5: Stripe Checkout ----------
    const successUrl = `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=success`;
    const cancelUrl = `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `Sponsored Area — Slot ${slot}`,
              description: "Monthly sponsorship of your chosen sub-region.",
            },
            recurring: { interval: "month" },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        area_id: areaId,
        slot: String(slot),
        business_id: businessId,
        preview_id: previewId || "",
        lock_id: lockId,
        km2: km2.toFixed(6),
      },
    });

    // Save the session id on our lock row (best-effort)
    try {
      await sb
        .from("sponsored_locks")
        .update({ stripe_session_id: session.id })
        .eq("id", lockId);
    } catch (_) {}

    return json({ url: session.url });
  } catch (err) {
    console.error("sponsored-checkout error:", err);
    return json({ error: "Checkout error" }, 500);
  }
};
