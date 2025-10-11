// netlify/functions/stripe-postverify.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/stripe-postverify" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }
  const { checkout_session } = await req.json();
  if (!checkout_session) {
    return new Response(JSON.stringify({ error: "checkout_session required" }), { status: 400 });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(checkout_session, { expand: ["subscription", "subscription.latest_invoice"] });
    const meta = session.metadata || {};
    const sub = session.subscription;

    if (!sub || typeof sub !== "object") {
      return new Response(JSON.stringify({ error: "No subscription on session" }), { status: 400 });
    }

    // write rows just like the webhook
    const business_id = meta?.cleaner_id || meta?.business_id || null;
    const area_id = meta?.area_id || null;
    const slot = Number(meta?.slot || 1);
    if (!business_id || !area_id) {
      return new Response(JSON.stringify({ error: "Missing metadata: area_id/cleaner_id" }), { status: 400 });
    }

    await supabase.from("sponsored_subscriptions").upsert({
      business_id,
      area_id,
      slot,
      stripe_customer_id: sub.customer,
      stripe_subscription_id: sub.id,
      price_monthly_pennies: sub.items?.data?.[0]?.price?.unit_amount ?? null,
      currency: sub.currency || "gbp",
      status: sub.status,
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    }, { onConflict: "stripe_subscription_id" });

    if (sub.latest_invoice && typeof sub.latest_invoice === "object") {
      const inv = sub.latest_invoice;
      const { data: subRow } = await supabase
        .from("sponsored_subscriptions")
        .select("id")
        .eq("stripe_subscription_id", sub.id)
        .single();

      if (subRow) {
        await supabase.from("sponsored_invoices").upsert({
          sponsored_subscription_id: subRow.id,
          stripe_invoice_id: inv.id,
          hosted_invoice_url: inv.hosted_invoice_url,
          invoice_pdf: inv.invoice_pdf,
          amount_due_pennies: inv.amount_due,
          currency: inv.currency,
          status: inv.status,
          period_start: new Date(inv.period_start * 1000).toISOString(),
          period_end: new Date(inv.period_end * 1000).toISOString(),
        }, { onConflict: "stripe_invoice_id" });
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
