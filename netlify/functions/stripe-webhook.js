// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// DO NOT set a custom config.path. The default path is:
//   /.netlify/functions/stripe-webhook
// export const config = { path: "/.netlify/functions/stripe-webhook" }; // <-- remove

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

// Small helper
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Best-effort “upsert” of our purchase record + invoice
async function upsertFromCheckoutSession(session) {
  // We only create a *sponsorship* record for the “payment” Checkout sessions we create.
  // Metadata is written by `sponsored-checkout.js`.
  const m = session?.metadata || {};
  const business_id = m.cleanerId || m.business_id || null;
  const area_id = m.areaId || null;
  const slot = Number(m.slot || 1);

  if (!business_id || !area_id) {
    console.warn("[webhook] missing metadata. business_id:", business_id, "area_id:", area_id);
    return;
  }

  // Normalize amounts
  const session_amount_total_pennies =
    typeof session.amount_total === "number" ? session.amount_total : null;

  const payload = {
    business_id,
    area_id,
    slot,
    stripe_customer_id: session.customer || null,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: session.payment_intent || null,
    status: "active",
    currency: (session.currency || "gbp").toLowerCase(),
    price_monthly_pennies: null, // we keep single-charge detail on invoice row
    current_period_end: null,    // n/a for one-off payments; useful if you add subscriptions later
    last_charge_total_pennies: session_amount_total_pennies,
  };

  // Upsert a single “sponsored_subscriptions” row to represent this sponsorship
  await supabase
    .from("sponsored_subscriptions")
    .upsert(payload, { onConflict: "stripe_checkout_session_id" });

  // Also write an invoice-style row for the Checkout session itself
  await supabase
    .from("sponsored_invoices")
    .upsert(
      {
        // you can keep a loose foreign key via checkout_session_id (or use a DB trigger to resolve to FK)
        sponsored_subscription_id: null,
        stripe_invoice_id: session.id, // not a real Stripe invoice, but gives you a stable id per charge
        hosted_invoice_url: session.url || null,
        invoice_pdf: null,
        amount_due_pennies: session_amount_total_pennies,
        currency: (session.currency || "gbp").toLowerCase(),
        status: session.payment_status, // 'paid','unpaid'
        period_start: new Date().toISOString(),
        period_end: new Date().toISOString(),
      },
      { onConflict: "stripe_invoice_id" }
    );
}

export default async (req) => {
  // Make browser health-checks easy
  if (req.method === "GET") {
    return json({ ok: true, note: "Stripe webhook is deployed. Use POST from Stripe." });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return json({ error: "Missing Stripe signature" }, 400);

  let event;
  try {
    const raw = await req.text(); // keep body raw for signature verification
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("[webhook] signature verify failed:", e?.message);
    return json({ error: "Bad signature" }, 400);
  }

  try {
    switch (event.type) {
      // Our Checkout mode is "payment" (one-off), so this is the primary event to act on.
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log("[webhook] checkout.session.completed", {
          id: session.id,
          payment_status: session.payment_status,
          amount_total: session.amount_total,
          currency: session.currency,
          metadata: session.metadata,
        });

        // If you ever change to subscriptions, you can expand the subscription here as needed.
        await upsertFromCheckoutSession(session);
        break;
      }

      // Optional: capture a record for generated Stripe invoices (useful if you later move to subscriptions)
      case "invoice.paid":
      case "invoice.payment_failed": {
        const inv = event.data.object;
        console.log("[webhook] invoice event", inv.id, inv.status);

        // Try to connect invoice to an existing sponsorship by subscription id
        const { data: subRow } = await supabase
          .from("sponsored_subscriptions")
          .select("id")
          .eq("stripe_subscription_id", inv.subscription || "")
          .maybeSingle();

        await supabase
          .from("sponsored_invoices")
          .upsert(
            {
              sponsored_subscription_id: subRow?.id || null,
              stripe_invoice_id: inv.id,
              hosted_invoice_url: inv.hosted_invoice_url,
              invoice_pdf: inv.invoice_pdf,
              amount_due_pennies: inv.amount_due,
              currency: inv.currency,
              status: inv.status,
              period_start: new Date(inv.period_start * 1000).toISOString(),
              period_end: new Date(inv.period_end * 1000).toISOString(),
            },
            { onConflict: "stripe_invoice_id" }
          );

        if (subRow?.id) {
          await supabase
            .from("sponsored_subscriptions")
            .update({ status: inv.status === "paid" ? "active" : "past_due" })
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
        // Ignore other events to keep the webhook lean
        break;
    }

    return json({ received: true });
  } catch (e) {
    console.error("[webhook] handler error:", e);
    // Return 200 so Stripe doesn’t keep retrying forever while you iterate;
    // flip to 500 once things are stable and you want automatic retries.
    return json({ ok: false, error: e?.message || "webhook failed" }, 200);
  }
};
