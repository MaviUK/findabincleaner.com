import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  // You can pass either stripe_subscription_id, or (business_id + area_id + slot)
  const { searchParams } = new URL(req.url);
  const stripeSubId = searchParams.get("stripe_subscription_id");
  const business_id = searchParams.get("business_id");
  const area_id = searchParams.get("area_id");
  const slot = searchParams.get("slot") ? Number(searchParams.get("slot")) : null;

  try {
    let subRow;

    if (stripeSubId) {
      const q = await supabase
        .from("sponsored_subscriptions")
        .select("*")
        .eq("stripe_subscription_id", stripeSubId)
        .maybeSingle();
      subRow = q.data;
    } else if (business_id && area_id && slot != null) {
      const q = await supabase
        .from("sponsored_subscriptions")
        .select("*")
        .eq("business_id", business_id)
        .eq("area_id", area_id)
        .eq("slot", slot)
        .maybeSingle();
      subRow = q.data;
    } else {
      return json({ error: "Missing identifiers" }, 400);
    }

    if (!subRow) return json({ subscription: null });

    // Pull live flags from Stripe (cancel_at_period_end etc)
    const sub = await stripe.subscriptions.retrieve(subRow.stripe_subscription_id);

    return json({
      subscription: {
        id: sub.id,
        status: sub.status,
        cancel_at_period_end: sub.cancel_at_period_end,
        current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
        price: sub.items?.data?.[0]?.price?.unit_amount ?? null,
        currency: sub.items?.data?.[0]?.price?.currency ?? "gbp",
      },
    });
  } catch (e) {
    console.error("[subscription-get] error:", e);
    return json({ error: "Server error" }, 500);
  }
};
