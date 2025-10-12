// netlify/functions/stripe-postverify.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/stripe-postverify" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { checkout_session } = await req.json().catch(() => ({}));
  if (!checkout_session) return json({ error: "checkout_session required" }, 400);

  try {
    const session = await stripe.checkout.sessions.retrieve(checkout_session, {
      expand: ["subscription", "subscription.latest_invoice", "payment_intent"],
    });

    const meta = session.metadata || {};
    const business_id = meta.cleaner_id || meta.business_id || meta.cleanerId || null;
    const area_id = meta.area_id || meta.areaId || null;
    const slot = Number(meta.slot || 1);
    const months = Number(meta.months || 1);
    const stripe_customer_id = session.customer || null;

    if (!business_id || !area_id) {
      return json({ error: "Missing metadata: area_id/cleaner_id" }, 400);
    }

    if (session.mode === "subscription") {
      // SUBSCRIPTION
      const sub =
        typeof session.subscription === "string"
          ? await stripe.subscriptions.retrieve(session.subscription, { expand: ["latest_invoice"] })
          : session.subscription;

      const payload = {
        business_id,
        area_id,
        slot,
        status: sub?.status || "active",
        currency: sub?.currency || "gbp",
        price_monthly_pennies: sub?.items?.data?.[0]?.price?.unit_amount ?? null,
        stripe_customer_id,
        stripe_subscription_id: sub?.id || null,
        current_period_end: sub?.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
      };

      const { error: upErr } = await supabase
        .from("sponsored_subscriptions")
        .upsert(payload, { onConflict: "stripe_subscription_id" });
      if (upErr) throw upErr;
    } else {
      // ONE-OFF PAYMENT (prepay N months)
      const pi =
        typeof session.payment_intent === "string"
          ? await stripe.paymentIntents.retrieve(session.payment_intent)
          : session.payment_intent;

      const payload = {
        business_id,
        area_id,
        slot,
        status: "active",
        currency: (pi && pi.currency) || "gbp",
        price_monthly_pennies: Number(meta.monthly_price_pennies) || null,
        stripe_customer_id,
        stripe_payment_intent_id: pi?.id || null,
        months_prepaid: Number.isFinite(months) ? months : 1,
        checkout_session_id: session.id,
      };

      const { error: upErr } = await supabase.from("sponsored_subscriptions").upsert(payload);
      if (upErr) throw upErr;
    }

    return json({ ok: true });
  } catch (e) {
    console.error("[stripe-postverify] error", e);
    return json({ error: e?.message || "postverify failed" }, 500);
  }
};
