// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/stripe-webhook" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Upsert a row in sponsored_subscriptions based on a Stripe subscription
async function upsertSubscription(sub, meta) {
  const business_id = meta?.cleaner_id || meta?.business_id || null;
  const area_id = meta?.area_id || null;
  const slot = Number(meta?.slot || 1);

  if (!business_id || !area_id) return;

  // price is in the subscription items
  const item = sub.items?.data?.[0] || null;
  const unit_amount = item?.price?.unit_amount ?? null; // pence
  const currency = item?.price?.currency ?? sub.currency ?? "gbp";

  // Upsert subscription
  await supabase.from("sponsored_subscriptions").upsert(
    {
      business_id,
      area_id,
      slot,
      stripe_customer_id: sub.customer,
      stripe_subscription_id: sub.id,
      price_monthly_pennies: unit_amount,
      currency,
      status: sub.status, // active, trialing, past_due, canceled, etc
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
    },
    { onConflict: "stripe_subscription_id" }
  );

  // If latest invoice is expanded, mirror it too
  const inv =
    typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
  if (inv) {
    const { data: subRow } = await supabase
      .from("sponsored_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", sub.id)
      .maybeSingle();

    if (subRow) {
      await supabase.from("sponsored_invoices").upsert(
        {
          sponsored_subscription_id: subRow.id,
          stripe_invoice_id: inv.id,
          hosted_invoice_url: inv.hosted_invoice_url ?? null,
          invoice_pdf: inv.invoice_pdf ?? null,
          amount_due_pennies: inv.amount_due ?? null,
          currency: inv.currency ?? currency,
          status: inv.status ?? null,
          period_start: inv.period_start
            ? new Date(inv.period_start * 1000).toISOString()
            : null,
          period_end: inv.period_end
            ? new Date(inv.period_end * 1000).toISOString()
            : null,
        },
        { onConflict: "stripe_invoice_id" }
      );
    }
  }
}

export default async (req) => {
  // Stripe POSTs only. A GET is useful for quick health checks.
  if (req.method === "GET") {
    return json({
      ok: true,
      note: "Stripe webhook is deployed. Use POST from Stripe.",
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const sig = req.headers.get("stripe-signature");
  if (!sig) return json({ error: "Missing stripe-signature" }, 400);

  let event;
  try {
    const raw = await req.text();
    event = stripe.webhooks.constructEvent(
      raw,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    // Signature mismatch (usually wrong secret or wrong mode)
    return json({ error: "Bad signature" }, 400);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        // When you used Checkout in subscription mode
        const session = event.data.object;
        if (session.mode === "subscription" && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription, {
            expand: ["latest_invoice", "items.price"],
          });
          await upsertSubscription(sub, session.metadata || {});
        }
        break;
      }

      case "invoice.paid":
      case "invoice.payment_failed": {
        const inv = event.data.object;
        // mirror invoice + update subscription status snapshot
        const { data: subRow } = await supabase
          .from("sponsored_subscriptions")
          .select("id")
          .eq("stripe_subscription_id", inv.subscription)
          .maybeSingle();

        if (subRow) {
          await supabase.from("sponsored_invoices").upsert(
            {
              sponsored_subscription_id: subRow.id,
              stripe_invoice_id: inv.id,
              hosted_invoice_url: inv.hosted_invoice_url ?? null,
              invoice_pdf: inv.invoice_pdf ?? null,
              amount_due_pennies: inv.amount_due ?? null,
              currency: inv.currency ?? null,
              status: inv.status ?? null,
              period_start: inv.period_start
                ? new Date(inv.period_start * 1000).toISOString()
                : null,
              period_end: inv.period_end
                ? new Date(inv.period_end * 1000).toISOString()
                : null,
            },
            { onConflict: "stripe_invoice_id" }
          );

          // keep a simple status on the subscription row
          await supabase
            .from("sponsored_subscriptions")
            .update({
              status: inv.status === "paid" ? "active" : "past_due",
            })
            .eq("id", subRow.id);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await supabase
          .from("sponsored_subscriptions")
          .update({ status: "canceled" })
          .eq("stripe_subscription_id", sub.id);
        break;
      }

      default:
        // ignore others
        break;
    }

    return json({ ok: true });
  } catch (e) {
    console.error("[stripe-webhook] handler error:", e);
    return json({ error: e?.message || "webhook error" }, 500);
  }
};
