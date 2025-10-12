// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

/**
 * IMPORTANT for Stripe signatures on Netlify:
 * - We must read the raw body (not JSON-parsed) so the signature verifies.
 * - The "path" keeps this function from being swallowed by the SPA redirect.
 */
export const config = {
  path: "/.netlify/functions/stripe-webhook",
  body: "raw", // ensure raw body for signature verification
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const j = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Statuses we consider “live/active-ish”. */
const ACTIVE = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

/** Pull cleaner/area/slot from metadata when available; otherwise fall back to customer lookup. */
async function resolveContext({ meta, customerId }) {
  const business_id = meta?.cleaner_id || meta?.business_id || null;
  const area_id = meta?.area_id || null;
  const slot = meta?.slot ? Number(meta.slot) : null;
  if (business_id && area_id && slot) return { business_id, area_id, slot };

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

/** Create/update our subscription record from a Stripe Subscription. */
async function upsertSubscription(sub, meta = {}) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const { business_id, area_id, slot } = await resolveContext({ meta, customerId });

  const firstItem = sub.items?.data?.[0];
  const price = firstItem?.price;

  const payload = {
    business_id,
    area_id,
    slot: slot ?? null,
    stripe_customer_id: customerId ?? null,
    stripe_subscription_id: sub.id,
    price_monthly_pennies: price?.unit_amount ?? null,
    currency: (price?.currency || sub.currency || "gbp")?.toLowerCase(),
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

/** Create/update our invoices table and mirror basic status back to the sub-row. */
async function upsertInvoice(inv) {
  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

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
    currency: (inv.currency || "gbp")?.toLowerCase(),
    status: inv.status,
    period_start: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
    period_end: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
  };

  const { error } = await supabase
    .from("sponsored_invoices")
    .upsert(payload, { onConflict: "stripe_invoice_id" });

  if (error) console.error("[webhook] upsert invoice error:", error, payload);

  // Mirror invoice -> subscription status (basic)
  if (subRow?.id) {
    let mirror = null;
    if (inv.status === "paid") mirror = "active";
    else if (["open", "void"].includes(inv.status)) mirror = inv.status;

    if (mirror) {
      const { error: updErr } = await supabase
        .from("sponsored_subscriptions")
        .update({ status: mirror })
        .eq("id", subRow.id);
      if (updErr) console.error("[webhook] update sub status error:", updErr);
    }
  }
}

export default async (req) => {
  if (req.method === "GET") {
    // Health-check in a browser without tripping SPA redirects
    return j({ ok: true, note: "Stripe webhook is deployed. Use POST from Stripe." });
  }
  if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);

  const sig = req.headers.get("stripe-signature");
  if (!sig) return j({ error: "Missing Stripe signature header" }, 400);

  let event;
  try {
    const raw = await req.text(); // RAW BODY is required for verification
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[webhook] bad signature:", err?.message);
    return j({ error: "Bad signature" }, 400);
  }

  try {
    // Helpful trace in Netlify logs
    console.log(`[webhook] ${event.type}  id=${event.id}`);

    switch (event.type) {
      /**
       * Checkout completed (contains our metadata). We grab the created
       * Subscription and its latest_invoice and persist both sides.
       */
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription, {
            expand: ["latest_invoice", "customer", "items.data.price.product"],
          });
          await upsertSubscription(sub, session.metadata || {});
          if (sub.latest_invoice && typeof sub.latest_invoice === "object") {
            await upsertInvoice(sub.latest_invoice);
          }
        }
        break;
      }

      /** Sub lifecycle (created/updated via Checkout or Billing Portal). */
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        await upsertSubscription(sub, sub.metadata || {});
        break;
      }

      /** Cancellations (from Billing Portal etc.). */
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const { error } = await supabase
          .from("sponsored_subscriptions")
          .update({ status: "canceled" })
          .eq("stripe_subscription_id", sub.id);
        if (error) console.error("[webhook] cancel sub error:", error);
        break;
      }

      /** Keep invoices table synced; mirror status to sub. */
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.finalized":
      case "invoice.voided": {
        await upsertInvoice(event.data.object);
        break;
      }

      default:
        // No-op for the rest
        break;
    }

    return j({ ok: true });
  } catch (e) {
    console.error("[webhook] handler error:", e);
    return j({ error: e?.message || "Server error" }, 500);
  }
};
