import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const businessId = body?.businessId || null; // cleaners.id
  const areaId = body?.areaId || null;
  const slot = Number(body?.slot) || null;

  console.log("[subscription-cancel] payload:", { businessId, areaId, slot });

  if (!businessId || !areaId || !slot) {
    return json({ ok: false, error: "Missing params" }, 400);
  }

  // Look up the user’s subscription in our DB to find the Stripe sub id
  const { data: subRow, error: subErr } = await supabase
    .from("sponsored_subscriptions")
    .select("id, stripe_subscription_id")
    .eq("business_id", businessId)
    .eq("area_id", areaId)
    .eq("slot", slot)
    .maybeSingle();

  if (subErr) {
    console.error("[subscription-cancel] DB error:", subErr);
    return json({ ok: false, error: "DB error" }, 500);
  }
  if (!subRow?.stripe_subscription_id) {
    return json({ ok: false, error: "Subscription not found" }, 404);
  }

  // Cancel at period end on Stripe
  await stripe.subscriptions.update(subRow.stripe_subscription_id, {
    cancel_at_period_end: true,
  });

  // Mirror locally
  const { error: updErr } = await supabase
    .from("sponsored_subscriptions")
    .update({ status: "canceled" })
    .eq("id", subRow.id);

  if (updErr) {
    console.error("[subscription-cancel] local mirror error:", updErr);
    // Still report ok (Stripe change is what matters), but surface the local failure
    return json({ ok: true, warn: "Stripe updated; local status not updated" });
  }

  return json({ ok: true });
}
