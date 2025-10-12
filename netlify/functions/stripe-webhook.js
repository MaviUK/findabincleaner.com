// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/stripe-webhook" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

// Convenience JSON reply
const j = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Map Stripe sub status to our idea of “active”
const ACTIVE = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

// Find business_id/area_id/slot for this Stripe object
async function resolveContext({ meta, customerId }) {
  // 1) If metadata arrived on the event/subscription/session, prefer that
  const business_id = meta?.cleaner_id || meta?.business_id || null;
  const area_id = meta?.area_id || null;
  const slot = meta?.slot ? Number(meta.slot) : null;
  if (business_id && area_id && slot) return { business_id, area_id, slot };

  // 2) Otherwise, try to look up the Cleaner row by customer id
  if (customerId) {
    const { data } = await supabase
      .from("cleaners")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    if (data?.id) return { business_id: data.id, area_id: null, slot: null };
  }

  return { business_id: null, area_id: null, slot: null };
}

async function upsertSubscription(sub, meta = {}) {
  // Resolve business/area/slot when possible
  const { business_id, area_id, slot } = await resolveContext({
    meta,
    customerId: sub.customer && typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
  });

  // If we don't know business/area yet, we still upsert a row keyed by stripe ids
  // so later invoice events can fill in the missing fields.
  const payload = {
    business_id,
    area_id,
    slot: slot ?? null,
    stripe_customer_id:
      typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
    stripe_subscription_id: sub.id,
    price_monthly_pennies: sub.items?.data?.[0]?.price?.unit_amount ?? null,
    currency: sub.currency || sub.items?.data?.[0]?.price?.currency || "gbp",
    status: sub.status,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
  };

  const { error } = await supabase
    .from("sponsored_subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  if (error) console.error("[webhook] upsert sub error:", error, payload);
}

async function upsertInvoice(inv) {
  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

  // Find our subscription row fk
  const { data: subRow } = await supabase
    .from("sponsored_subscriptions")
    .select("id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  const payload = {
    sponsored_subscription_id: subRow?.id ?? null,
    stripe_invoice_id: inv.id,
    hosted_invoice_url: inv.hosted_invoice_url,
    invoice_pdf: inv.invoice_pdf,
    amount_due_pennies: inv.amount_due,
    currency: inv.currency,
    status: inv.status,
    period_start: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
    period_end: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
  };

  const { error } = await supabase
    .from("sponsored_invoices")
    .upsert(payload, { onConflict: "stripe_invoice_id" });

  if (error) console.error("[webhook] upsert invoice error:", error, payload);

  // Also mirror invoice status to subscription if we know the sub row
  if (subRow?.id && (inv.status === "paid" || inv.status === "open" || inv.status === "void")) {
    const newStatus = inv.status === "paid" ? "active" : inv.status;
    const { error: updErr } = await supabase
      .from("sponsored_subscriptions")
      .update({ status: newStatus })
      .eq("id", subRow.id);
    if (updErr) console.error("[webhook] update sub status error:", updErr);
  }
}

export default async (req) => {
  if (req.method === "GET") {
    // Simple health-check in a browser
    return j({ ok: true, note: "Stripe webhook is deployed. Use POST from Stripe." });
  }
  if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);

  const sig = req.headers.get("stripe-signature");
  if (!sig) return j({ error: "Missing Stripe signature header" }, 400);

  let event;
  try {
    const raw = await req.text();
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[webhook] bad signature:", err?.message);
    return j({ error: "Bad signature" }, 400);
  }

  try {
    switch (event.type) {
      // Checkout success (has our metadata)
      case "checkout.session.completed": {
        const session = event.data.object;
        // Fetch full subscription with invoice for amounts
        if (session.mode === "subscription" && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription, {
            expand: ["latest_invoice", "customer"],
          });
          await upsertSubscription(sub, session.metadata || {});
          if (sub.latest_invoice && typeof sub.latest_invoice === "object") {
            await upsertInvoice(sub.latest_invoice);
          }
        }
        break;
      }

      // Portal & lifecycle events — write/update the subscription
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        await upsertSubscription(sub, sub.metadata || {});
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const { error } = await supabase
          .from("sponsored_subscriptions")
          .update({ status: "canceled" })
          .eq("stripe_subscription_id", sub.id);
        if (error) console.error("[webhook] cancel sub error:", error);
        break;
      }

      // Keep invoices table in sync
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.finalized":
      case "invoice.voided": {
        await upsertInvoice(event.data.object);
        break;
      }

      default:
        // Ignore other events
        break;
    }

    return j({ ok: true });
  } catch (e) {
    console.error("[webhook] handler error:", e);
    return j({ error: e?.message || "Server error" }, 500);
  }
};
