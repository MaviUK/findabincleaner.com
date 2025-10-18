import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const { business_id, area_id, slot } = payload || {};
    if (!business_id || !area_id || !slot) {
      return new Response(JSON.stringify({ error: "Missing params" }), { status: 400 });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

    const { data, error } = await supabase
      .from("sponsored_subscriptions")
      .select("stripe_subscription_id")
      .eq("business_id", business_id)
      .eq("area_id", area_id)
      .eq("slot", slot)
      .maybeSingle();

    if (error) throw error;
    if (!data?.stripe_subscription_id) {
      return new Response(JSON.stringify({ error: "Subscription not found" }), { status: 404 });
    }

    // Set cancel at period end
    await stripe.subscriptions.update(data.stripe_subscription_id, { cancel_at_period_end: true });

    // Mirror immediately in DB (webhook will also eventually reflect)
    await supabase
      .from("sponsored_subscriptions")
      .update({ status: "active" }) // keep active until end; you could store a flag if desired
      .eq("stripe_subscription_id", data.stripe_subscription_id);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || "Server error" }), { status: 500 });
  }
};
