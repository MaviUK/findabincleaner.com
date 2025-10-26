// netlify/functions/sponsored-checkout.js
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

// BLOCKING set aligned with preview
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);
const isBlocking = (s) => BLOCKING.has(String(s || "").toLowerCase());

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
    // Best-effort cleanup for stale locks (>35m) if you created that RPC
    try { await sb.rpc("cleanup_stale_sponsored_locks"); } catch {}

    // STEP 1: If another business already holds a BLOCKING sponsor, hard block
    const { data: existing, error: exErr } = await sb
      .from("sponsored_subscriptions")
      .select("id, status, business_id, final_geojson")
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

    // STEP 2: Acquire/refresh the concurrency lock via UPSERT
    // - If the same business already has the lock, refresh it (no 409).
    // - If the lock is stale (>35m), take it over.
    // - Otherwise, return 409.
    let lockId = null;
    {
      // Try to upsert first; ON CONFLICT requires specifying the conflict target
      // Supabase upsert will do INSERT ... ON CONFLICT (area_id,slot) DO UPDATE ...
      const { data: up, error: upErr } = await sb
        .from("sponsored_locks")
        .upsert(
          {
            area_id: areaId,
            slot,
            business_id: businessId,
            created_at: new Date().toISOString(),
          },
          { onConflict: "area_id,slot", ignoreDuplicates: false, returning: "representation" }
        )
        .select("id, area_id, slot, business_id, created_at")
        .single();

      if (upErr) throw upErr;

      // If the row belongs to another business and isn't stale, reject
      const createdAt = up.created_at ? new Date(up.created_at) : new Date();
      const ageMin = (Date.now() - createdAt.getTime()) / 60000;

      if (up.business_id !== businessId && ageMin <= 35) {
        return json(
          { error: `Another checkout is already holding slot #${slot} for this area.` },
          409
        );
      }

      // If it belonged to another business but was stale, we’ve just refreshed it to us.
      lockId = up.id;
    }

    // STEP 3: Re-run geometry with same BLOCKING set
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

    const blockers = (subs || []).filter((s) => isBlocking(s.status));
    if (blockers.some((b) => !b.final_geojson)) {
      return json({ error: "No purchasable area left for this slot." }, 400);
    }

    let available = base;
    for (const b of blockers) {
      const g = b.final_geojson;
      if (!g) continue;
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

    // STEP 4: Price
    const rate = rateForSlot(slot);
    const min = minForSlot(slot);
    const monthly = Math.max(km2 * rate, min);
    const unitAmount = Math.round(monthly * 100);

    // STEP 5: Stripe session
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

    // best-effort: store the session id on the lock
    try {
      await sb
        .from("sponsored_locks")
        .update({ stripe_session_id: session.id })
        .eq("id", lockId);
    } catch {}

    return json({ url: session.url });
  } catch (err) {
    console.error("sponsored-checkout error:", err);
    return json({ error: "Checkout error" }, 500);
  }
};
