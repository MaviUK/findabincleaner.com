// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/stripe-webhook" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

// Small helper
function ok(body = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
function err(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Persist the Stripe customer id on the cleaner (best-effort).
 */
async function rememberCleanerCustomer(cleaner_id, stripe_customer_id) {
  if (!cleaner_id || !stripe_customer_id) return;
  try {
    await supabase.from("cleaners").update({ stripe_customer_id }).eq("id", cleaner_id);
  } catch (_) {}
}

/**
 * Upsert a subscription-style purchase (recurring).
 */
async function upsertSubscriptionFromSession(session) {
  // session is expanded with subscription + customer
  const meta = session.metadata || {};
  const business_id = meta.cleanerId || meta.cleaner_id || null;
  const area_id = meta.areaId || meta.area_id || null;
  const slot = Number(meta.slot || 1);

  const subscription = session.subscription;
  const customer = session.customer;

  if (!business_id || !area_id || !subscription || !customer) return;

  // Persist cleaner ↔ customer mapping for the Billing Portal to find later
  await rememberCleanerCustomer(business_id, typeof customer === "string" ? customer : customer.id);

  // Pull expanded subscription w/ latest invoice if not expanded
  const sub =
    typeof subscription === "string"
      ? await stripe.subscriptions.retrieve(subscription, { expand: ["latest_invoice"] })
      : subscription;

  const stripe_customer_id = typeof customer === "string" ? customer : customer.id;
  const stripe_subscription_id = sub.id;
  const currency =
    sub.items?.data?.[0]?.price?.currency ||
    (sub.latest_invoice && typeof sub.latest_invoice === "object" ? sub.latest_invoice.currency : "gbp");

  // Upsert the subscription row
  await supabase
    .from("sponsored_subscriptions")
    .upsert(
      {
        business_id,
        area_id,
        slot,
        stripe_customer_id,
        stripe_subscription_id,
        price_monthly_pennies: sub.items?.data?.[0]?.price?.unit_amount ?? null,
        currency: currency || "gbp",
        status: sub.status, // 'active','trialing','past_due','canceled', ...
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      },
      { onConflict: "stripe_subscription_id" }
    );

  // If we have an invoice on the subscription, save it too
  if (sub.latest_invoice && typeof sub.latest_invoice === "object") {
    const inv = sub.latest_invoice;
    // get the id of the sponsored_subscriptions row we just upserted
    const { data: subRow } = await supabase
      .from("sponsored_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", sub.id)
      .single();

    if (subRow) {
      await supabase
        .from("sponsored_invoices")
        .upsert(
          {
            sponsored_subscription_id: subRow.id,
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
    }
  }
}

/**
 * Record a one-off payment (payment mode). We still record it in sponsored_invoices so
 * you have a ledger, but there won't be a recurring subscription row.
 */
async function upsertOneOffFromSession(session) {
  const meta = session.metadata || {};
  const business_id = meta.cleanerId || meta.cleaner_id || null;
  const area_id = meta.areaId || meta.area_id || null;
  const slot = Number(meta.slot || 1);

  if (!business_id || !area_id) return;

  // Persist cleaner ↔ customer mapping for the Billing Portal
  const customer = session.customer;
  const stripe_customer_id = typeof customer === "string" ? customer : customer?.id || null;
  if (stripe_customer_id) await rememberCleanerCustomer(business_id, stripe_customer_id);

  // Create a pseudo “invoice” row using the Checkout Session amounts
  const amount_due_pennies = session.amount_total ?? null;
  const currency = session.currency || "gbp";

  // If you want to tie one-off invoices to a subscription row, you could create a
  // “synthetic” subscription row per business/area/slot. For now, we store as invoice-only.
  await supabase.from("sponsored_invoices").insert({
    sponsored_subscription_id: null,
    stripe_invoice_id: session.id, // store session id to avoid duplicates
    hosted_invoice_url: session.invoice?.hosted_invoice_url || null,
    invoice_pdf: null,
    amount_due_pennies,
    currency,
    status: session.payment_status, // 'paid'
    period_start: new Date(session.created * 1000).toISOString(),
    period_end: new Date(session.created * 1000).toISOString(),
  });
}

export default async (req) => {
  if (req.method !== "POST") {
    // Helpful GET for sanity checks in browser
    return ok({ ok: true, note: "Stripe webhook is deployed. Use POST from Stripe." });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return err(400, "Missing Stripe signature");

  let event;
  try {
    const raw = await req.text();
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("[webhook] bad signature:", e?.message);
    return err(400, "Bad signature");
  }

  try {
    switch (event.type) {
      /**
       * Fires for both `mode: "subscription"` and `mode: "payment"`.
       * We branch based on session.mode.
       */
      case "checkout.session.completed": {
        const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
          expand: ["subscription", "customer", "invoice"],
        });

        if (session.mode === "subscription" && session.subscription) {
          await upsertSubscriptionFromSession(session);
        } else if (session.mode === "payment") {
          await upsertOneOffFromSession(session);
        }
        break;
      }

      /**
       * Keep subscription status fresh + store invoices.
       */
      case "invoice.paid":
      case "invoice.payment_failed": {
        const inv = event.data.object;

        // Link invoice to an existing subscription row (if we have one)
        const { data: subRow } = await supabase
          .from("sponsored_subscriptions")
          .select("id")
          .eq("stripe_subscription_id", inv.subscription)
          .maybeSingle();

        if (subRow) {
          await supabase
            .from("sponsored_invoices")
            .upsert(
              {
                sponsored_subscription_id: subRow.id,
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

          // Update subscription status to reflect invoice result
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
        // No-op for other events
        break;
    }

    return ok();
  } catch (e) {
    console.error("[webhook] handler error:", e);
    return err(500, e?.message || "webhook error");
  }
};
