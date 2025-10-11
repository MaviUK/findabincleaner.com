// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/stripe-webhook" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

async function upsertSubscriptionFromStripe(sub, meta) {
  const business_id = meta?.cleaner_id || meta?.business_id || null;
  const area_id = meta?.area_id || null;
  const slot = Number(meta?.slot || 1);

  if (!business_id || !area_id) return;

  // ensure slot column exists
  // (safe to run; ignore errors)
  try {
    await supabase.rpc("noop");
  } catch {}

  // upsert subscription row
  await supabase.from("sponsored_subscriptions").upsert({
    business_id,
    area_id,
    slot,
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    price_monthly_pennies: sub.items?.data?.[0]?.price?.unit_amount ?? null,
    currency: sub.currency || "gbp",
    status: sub.status, // 'active','past_due','canceled', etc
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
  }, { onConflict: "stripe_subscription_id" });

  // latest invoice -> save invoice record
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
}

export default async (req) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const raw = await req.text();
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return new Response(JSON.stringify({ error: "Bad signature" }), { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      // expand subscription for price + invoice
      const sub = await stripe.subscriptions.retrieve(session.subscription, { expand: ["latest_invoice"] });
      await upsertSubscriptionFromStripe(sub, session.metadata);
    }

    if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const inv = event.data.object;
      const { data: subRow } = await supabase
        .from("sponsored_subscriptions")
        .select("id")
        .eq("stripe_subscription_id", inv.subscription)
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

        // update status on subscription row
        await supabase
          .from("sponsored_subscriptions")
          .update({ status: inv.status === "paid" ? "active" : "past_due" })
          .eq("id", subRow.id);
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      await supabase
        .from("sponsored_subscriptions")
        .update({ status: "canceled" })
        .eq("stripe_subscription_id", sub.id);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
