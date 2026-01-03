// netlify/functions/stripe-postverify.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async (req) => {
  if (req.method === "GET") {
    return json({ ok: true, note: "stripe-postverify is deployed. Use POST with { checkout_session }." });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const { checkout_session } = await req.json();
    if (!checkout_session) return json({ ok: false, error: "checkout_session required" }, 400);

    const session = await stripe.checkout.sessions.retrieve(checkout_session, {
      expand: ["subscription", "customer", "line_items.data.price"],
    });

    if (session.status !== "complete") {
      return json({ ok: false, status: session.status });
    }

    const subObj = typeof session.subscription === "string" ? null : session.subscription;
    const subId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id || null;

    const custId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id || null;

    const meta = session.metadata || {};
    const business_id =
      meta.business_id || meta.cleaner_id || meta.cleanerId || meta.businessId || null;
    const area_id = meta.area_id || meta.areaId || null;
    const category_id = meta.category_id || meta.categoryId || null;
    const slot = Number(meta.slot || 1);
    const lock_id = meta.lock_id || null;

    if (!business_id || !area_id || !category_id || !subId || !custId) {
      return json(
        {
          ok: false,
          error: "Missing required metadata/customer/subscription",
          got: { business_id, area_id, category_id, slot, subId, custId, lock_id },
        },
        400
      );
    }

    const unitAmount = session.line_items?.data?.[0]?.price?.unit_amount ?? null;

    const currentPeriodEndIso =
      subObj?.current_period_end
        ? new Date(subObj.current_period_end * 1000).toISOString()
        : null;

    // ✅ get geojson from lock (best source of "final clipped" geometry)
    let final_geojson = null;
    if (lock_id) {
      const { data: lockRow } = await supabase
        .from("sponsored_locks")
        .select("final_geojson")
        .eq("id", lock_id)
        .maybeSingle();

      final_geojson = lockRow?.final_geojson ?? null;
    }

    // ✅ write using RPC that guarantees geometry
    const { data: upsertedId, error: upErr } = await supabase.rpc(
      "upsert_sponsored_subscription_with_geom",
      {
        p_business_id: business_id,
        p_area_id: area_id,
        p_category_id: category_id,
        p_slot: slot,
        p_stripe_customer_id: custId,
        p_stripe_subscription_id: subId,
        p_price_monthly_pennies: unitAmount ?? 0,
        p_currency: (session.currency || "gbp")?.toLowerCase(),
        p_status: "active",
        p_current_period_end: currentPeriodEndIso,
        p_final_geojson: final_geojson,
      }
    );

    if (upErr) throw upErr;

    // ✅ release lock immediately
    if (lock_id) {
      await supabase.from("sponsored_locks").update({ is_active: false }).eq("id", lock_id);
    }

    return json({
      ok: true,
      id: upsertedId,
      business_id,
      area_id,
      category_id,
      slot,
      stripe_subscription_id: subId,
      stripe_customer_id: custId,
    });
  } catch (e) {
    console.error("[stripe-postverify] error:", e);
    return json({ ok: false, error: e?.message || "post-verify failed" }, 500);
  }
};
