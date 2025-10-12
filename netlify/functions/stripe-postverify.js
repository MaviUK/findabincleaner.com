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
  // Helpful GET response so you can verify deploy from the browser
  if (req.method === "GET") {
    return json({ ok: true, note: "stripe-postverify is deployed. Use POST with { checkout_session }." });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const { checkout_session } = await req.json();
    if (!checkout_session) return json({ error: "checkout_session required" }, 400);

    // Pull the session (expand to get subscription + customer quickly)
    const session = await stripe.checkout.sessions.retrieve(checkout_session, {
      expand: ["subscription", "customer"],
    });

    // Only proceed for successful paid/complete sessions
    if (session.status !== "complete") {
      return json({ ok: false, status: session.status });
    }

    const subId = typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id || null;

    const custId = typeof session.customer === "string"
      ? session.customer
      : session.customer?.id || null;

    // metadata we set in Checkout
    const meta = session.metadata || {};
    const business_id = meta.cleaner_id || meta.cleanerId || null;
    const area_id = meta.area_id || meta.areaId || null;
    const slot = Number(meta.slot || 1);

    // Best-effort upsert (this mirrors what your webhook does)
    if (business_id && area_id && subId && custId) {
      await supabase.from("sponsored_subscriptions").upsert({
        business_id,
        area_id,
        slot,
        stripe_customer_id: custId,
        stripe_subscription_id: subId,
        price_monthly_pennies: Number(meta.monthly_price_pennies || 0) || null,
        currency: session.currency || "gbp",
        status: "active",
        current_period_end: session.subscription?.current_period_end
          ? new Date(session.subscription.current_period_end * 1000).toISOString()
          : null,
      }, { onConflict: "stripe_subscription_id" });
    }

    return json({ ok: true, business_id, area_id, slot, stripe_subscription_id: subId, stripe_customer_id: custId });
  } catch (e) {
    console.error("[stripe-postverify] error:", e);
    return json({ error: e?.message || "post-verify failed" }, 500);
  }
};
