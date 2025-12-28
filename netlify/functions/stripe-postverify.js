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

    // Expand so we can pull subscription/customer + line item price reliably
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

    // ✅ metadata (MATCHES sponsored-checkout)
    const meta = session.metadata || {};
    const business_id =
      meta.business_id || meta.cleaner_id || meta.cleanerId || meta.businessId || null;
    const area_id = meta.area_id || meta.areaId || null;
    const category_id = meta.category_id || meta.categoryId || null;
    const slot = Number(meta.slot || 1);

    if (!business_id || !area_id || !category_id || !subId || !custId) {
      return json(
        {
          ok: false,
          error: "Missing required metadata/customer/subscription",
          got: { business_id, area_id, category_id, slot, subId, custId },
        },
        400
      );
    }

    // ✅ price from line item (most reliable)
    const unitAmount =
      session.line_items?.data?.[0]?.price?.unit_amount ??
      null;

    // ✅ current_period_end from subscription (also reliable)
    const currentPeriodEndIso =
      subObj?.current_period_end
        ? new Date(subObj.current_period_end * 1000).toISOString()
        : null;

    await supabase
      .from("sponsored_subscriptions")
      .upsert(
        {
          business_id,
          area_id,
          category_id,
          slot,
          stripe_customer_id: custId,
          stripe_subscription_id: subId,
          price_monthly_pennies: unitAmount, // pennies
          currency: (session.currency || "gbp")?.toLowerCase(),
          status: "active",
          current_period_end: currentPeriodEndIso,
        },
        { onConflict: "stripe_subscription_id" }
      );

    // ✅ release lock immediately if present (so you don't see "being purchased")
    const lockId = meta.lock_id || null;
    if (lockId) {
      await supabase.from("sponsored_locks").update({ is_active: false }).eq("id", lockId);
    }

    return json({
      ok: true,
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
