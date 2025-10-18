import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { businessId, cleanerId, areaId, slot } = await req.json();

    if (!areaId || !slot || ![1, 2, 3].includes(Number(slot))) {
      return json({ ok: false, error: "Missing areaId/slot" }, 400);
    }

    // Resolve business id from cleanerId if needed
    let bid = businessId || null;
    if (!bid && cleanerId) {
      const { data, error } = await supabase
        .from("cleaners")
        .select("id")
        .eq("user_id", cleanerId)
        .maybeSingle();
      if (error) {
        console.error("[sub-cancel] cleaners lookup error:", error);
        return json({ ok: false, error: "Lookup failed" }, 500);
      }
      bid = data ? data.id : null;
    }

    if (!bid) return json({ ok: false, error: "Missing params" }, 400);

    // Find subscription
    const { data: sub, error: subErr } = await supabase
      .from("sponsored_subscriptions")
      .select("id, stripe_subscription_id, status")
      .eq("business_id", bid)
      .eq("area_id", areaId)
      .eq("slot", Number(slot))
      .maybeSingle();

    if (subErr) {
      console.error("[sub-cancel] query error:", subErr);
      return json({ ok: false, error: "Query failed" }, 500);
    }

    if (!sub || !sub.stripe_subscription_id) {
      return json({ ok: false, error: "Subscription not found" }, 404);
    }

    // Cancel at period end on Stripe
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    // Mirror locally
    await supabase
      .from("sponsored_subscriptions")
      .update({ status: "canceled" })
      .eq("id", sub.id);

    return json({ ok: true });
  } catch (e) {
    console.error("[sub-cancel] handler error:", e);
    return json({ ok: false, error: e && e.message ? e.message : "Server error" }, 500);
  }
};
