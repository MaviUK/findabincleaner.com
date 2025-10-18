// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

/**
 * Important for Stripe signatures on Netlify:
 *  - Keep a fixed path so SPA catch-all won't swallow it.
 *  - Use raw body so stripe.webhooks.constructEvent can verify the signature.
 */
export const config = {
  path: "/.netlify/functions/stripe-webhook",
  body: "raw",
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/* ------------------------------------------------------------------ helpers */

/** Try to resolve business/area/slot from metadata; otherwise fall back to the customer on the cleaners table. */
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

/** Create or update our sponsored_subscriptions row based on a Stripe Subscription. */
async function upsertSubscription(sub, meta = {}) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;

  // Prefer subscription.metadata, but allow caller to pass a fallback (e.g., session metadata)
  const mergedMeta = { ...(sub.metadata || {}), ...(meta || {}) };
  const { business_id, area_id, slot } = await resolveContext({ meta: mergedMeta, customerId });

  const firstItem = sub.items?.data?.[0];
  const price = firstItem?.price;

  const payload = {
    business_id,
    area_id,
    slot: slot ?? null,
    stripe_customer_id: customerId,
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

/**
 * Create or update our sponsored_invoices row, and mirror status back to the subscription.
 * If we don't yet have a sub row, fetch the Subscription and upsert it first (backfill).
 */
async function upsertInvoice(inv) {
  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

  // Ensure a sub row exists (backfill if necessary)
  let { data: subRow } = await supabase
    .from("sponsored_subscriptions")
    .select("id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (!subRow && subscriptionId) {
    // Fetch subscription to recover metadata, then upsert it
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["customer", "items.data.price.product"],
      });
      await upsertSubscription(sub, sub.metadata || {});
      const again = await supabase
        .from("sponsored_subscriptions")
        .select("id")
        .eq("stripe_subscription_id", subscriptionId)
        .maybeSingle();
      subRow = again.data || null;
    } catch (e) {
      console.error("[webhook] backfill subscription fetch failed:", e?.message);
    }
  }

  const payload = {
    sponsored_subscription_id: subRow?.id ?? null,
    stripe_invoice_id: inv.id,
    hosted_invoice_url: inv.hosted_invoice_url ?? null,
    invoice_pdf: inv.invoice_pdf ?? null,
    amount_due_pennies: inv.amount_due ?? null,
    currency: (inv.currency || "gbp")?.toLowerCase(),
    status: inv.status,
    period_start: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
    period_end: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
  };

  const { error } = await supabase
    .from("sponsored_invoices")
    .upsert(payload, { onConflict: "stripe_invoice_id" });

  if (error) console.error("[webhook] upsert invoice error:", error, payload);

  // Mirror invoice status → subscription status (simple mapping)
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

/* ------------------------------------------------------------------ handler */

export default async (req) => {
  // Quick health check in a browser
  if (req.method === "GET") {
    return json({ ok: true, note: "Stripe webhook is deployed. Use POST from Stripe." });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const sig = req.headers.get("stripe-signature");
  if (!sig) return json({ error: "Missing Stripe signature header" }, 400);

  let event;
  try {
    const raw = await req.text(); // raw body required for signature verification
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[webhook] bad signature:", err?.message);
    return json({ error: "Bad signature" }, 400);
  }

  try {
    console.log(`[webhook] ${event.type}  id=${event.id}`);

    switch (event.type) {
      // Checkout finished; fetch the created subscription and latest invoice to persist both sides.
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

      // Billing Portal + lifecycle updates
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

      // Keep invoices in sync; will also backfill a missing subscription row
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.finalized":
      case "invoice.voided": {
        await upsertInvoice(event.data.object);
        break;
      }

      default:
        // No-op for other events
        break;
    }

    return json({ ok: true });
  } catch (e) {
    console.error("[webhook] handler error:", e);
    return json({ error: e?.message || "Server error" }, 500);
  }
};
