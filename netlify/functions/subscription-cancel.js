import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const { stripe_subscription_id } = body || {};
    if (!stripe_subscription_id) return json({ error: "stripe_subscription_id required" }, 400);

    // Set cancel at period end
    const updated = await stripe.subscriptions.update(stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    // Optional: mirror to DB right away (webhook will also update on Stripe side)
    await supabase
      .from("sponsored_subscriptions")
      .update({ status: updated.status }) // often stays "active" until end
      .eq("stripe_subscription_id", stripe_subscription_id);

    return json({
      ok: true,
      subscription: {
        id: updated.id,
        status: updated.status,
        cancel_at_period_end: updated.cancel_at_period_end,
        current_period_end: updated.current_period_end
          ? new Date(updated.current_period_end * 1000).toISOString()
          : null,
      },
    });
  } catch (e) {
    console.error("[subscription-cancel] error:", e);
    return json({ error: "Server error" }, 500);
  }
};
