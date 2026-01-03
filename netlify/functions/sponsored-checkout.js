import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { areaId, slot = 1, businessId } = await req.json();
    if (!areaId || !businessId) return json({ error: "Missing areaId or businessId" }, 400);

    // Resolve category_id for area
    const { data: area, error: aErr } = await sb
      .from("service_areas")
      .select("id, category_id, name")
      .eq("id", areaId)
      .maybeSingle();
    if (aErr) return json({ error: aErr.message }, 500);
    if (!area) return json({ error: "Area not found" }, 404);

    const categoryId = area.category_id;

    // Prevent duplicate by same user for same area/slot
    const { data: existing, error: exErr } = await sb
      .from("sponsored_subscriptions")
      .select("id, status")
      .eq("business_id", businessId)
      .eq("area_id", areaId)
      .eq("slot", slot)
      .in("status", ["active", "trialing", "past_due", "incomplete"])
      .maybeSingle();
    if (exErr) return json({ error: exErr.message }, 500);
    if (existing) return json({ error: "You already have a subscription for this slot." }, 409);

    // 1) Ask DB what is remaining (source of truth)
    const { data: previewData, error: previewErr } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });
    if (previewErr) return json({ error: previewErr.message }, 500);

    const previewRow = Array.isArray(previewData) ? previewData[0] : previewData;

    const availableKm2 = Number(previewRow?.available_km2 ?? 0);
    if (!Number.isFinite(availableKm2) || availableKm2 <= 1e-9) {
      return json({ error: "Sold out", reason: previewRow?.reason || "no_remaining" }, 409);
    }

    const finalGeojson = previewRow?.gj;
    if (!finalGeojson) return json({ error: "No remaining geometry returned" }, 500);

    // 2) Create/refresh a lock row to freeze purchasable shape during checkout
    //    IMPORTANT: DB has a unique constraint on (area_id, slot). We must upsert safely.
    //    If another business currently holds an active (non-expired) lock, block checkout.
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString(); // 15 mins

    const { data: existingLock, error: lockFindErr } = await sb
      .from("sponsored_locks")
      .select("id, business_id, is_active, expires_at")
      .eq("area_id", areaId)
      .eq("slot", slot)
      .maybeSingle();

    if (lockFindErr) return json({ error: lockFindErr.message }, 500);

    const isExpired = (iso) => {
      if (!iso) return true;
      const t = Date.parse(iso);
      return Number.isNaN(t) ? true : t <= now.getTime();
    };

    if (
      existingLock?.id &&
      existingLock.is_active === true &&
      !isExpired(existingLock.expires_at) &&
      String(existingLock.business_id) !== String(businessId)
    ) {
      return json({ error: "Area is temporarily locked by another checkout", reason: "locked" }, 409);
    }

    let lockRow = null;
    if (existingLock?.id) {
      // Refresh/update the existing lock row (same business OR expired/inactive)
      const { data: updated, error: updErr } = await sb
        .from("sponsored_locks")
        .update({
          business_id: businessId,
          category_id: categoryId,
          final_geojson: finalGeojson,
          is_active: true,
          expires_at: expiresAt,
        })
        .eq("id", existingLock.id)
        .select("id")
        .single();
      if (updErr) return json({ error: updErr.message }, 500);
      lockRow = updated;
    } else {
      const { data: inserted, error: insErr } = await sb
        .from("sponsored_locks")
        .insert({
          business_id: businessId,
          area_id: areaId,
          category_id: categoryId,
          slot,
          final_geojson: finalGeojson,
          is_active: true,
          expires_at: expiresAt,
        })
        .select("id")
        .single();
      if (insErr) return json({ error: insErr.message }, 500);
      lockRow = inserted;
    }

    // 3) Create Stripe checkout session
    const PRICE_ID = process.env.SPONSORED_PRICE_ID;
    if (!PRICE_ID) return json({ error: "Missing SPONSORED_PRICE_ID env var" }, 500);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      success_url: `${process.env.APP_URL}/#dashboard?checkout=success`,
      cancel_url: `${process.env.APP_URL}/#dashboard?checkout=cancel`,
      metadata: {
        business_id: businessId,
        area_id: areaId,
        category_id: categoryId,
        slot: String(slot),
        lock_id: lockRow.id,
      },
      subscription_data: {
        metadata: {
          business_id: businessId,
          area_id: areaId,
          category_id: categoryId,
          slot: String(slot),
          lock_id: lockRow.id,
        },
      },
    });

    return json({ url: session.url });
  } catch (e) {
    return json({ error: e?.message || "Server error" }, 500);
  }
};
