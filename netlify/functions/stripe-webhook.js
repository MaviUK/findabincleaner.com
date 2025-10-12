// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/stripe-webhook" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Best-effort write so your app has a record to react to.
 * This targets the `sponsored_subscriptions` table you already have.
 * For one-time “payment” mode checkouts we store:
 *  - business_id  (cleaner)
 *  - area_id
 *  - slot
 *  - status='active'
 *  - stripe_customer_id
 *  - stripe_checkout_id
 *  - stripe_payment_intent_id
 *  - currency, amount_total_pennies
 */
async function upsertFromCheckoutSession(session) {
  const meta = session.metadata || {};
  const business_id = meta.cleanerId || meta.cleaner_id || null;
  const area_id = meta.areaId || meta.area_id || null;
  const slot = Number(meta.slot || 1);

  if (!business_id || !area_id) return;

  const amount_total_pennies =
    typeof session.amount_total === "number" ? session.amount_total : null;

  const row = {
    business_id,
    area_id,
    slot,
    status: "active",
    stripe_customer_id: session.customer || null,
    stripe_checkout_id: session.id,
    stripe_payment_intent_id: session.payment_intent || null,
    currency: session.currency || "gbp",
    amount_total_pennies,
  };

  // Upsert on (stripe_checkout_id) if your table has a unique index for it;
  // otherwise you can upsert on (business_id, area_id, slot).
  // If you don't have a unique constraint, a simple insert with ignore-on-conflict is fine.
  await supabase.from("sponsored_subscriptions").upsert(row, {
    onConflict: "stripe_checkout_id",
  });
}

export default async (req) => {
  try {
    if (req.method !== "POST") {
      // Function exists & is reachable
      return json({ error: "Method not allowed" }, 405);
    }

    const sig = req.headers.get("stripe-signature");
    if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
      return json({ error: "Missing Stripe signature or webhook secret" }, 400);
    }

    // IMPORTANT: use the raw body, not parsed JSON
    const raw = await req.text();

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        raw,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("[stripe-webhook] signature error:", err);
      return json({ error: `Signature verification failed: ${err.message}` }, 400);
    }

    // Handle events
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // If you need expanded fields, fetch the session with expansions:
        // const full = await stripe.checkout.sessions.retrieve(session.id, {
        //   expand: ["payment_intent", "customer", "line_items"],
        // });
        await upsertFromCheckoutSession(session);
        break;
      }

      case "invoice.paid": {
        // Optional: store invoice rows in sponsored_invoices if you want.
        // Keeping minimal here to avoid schema mismatches.
        break;
      }

      case "payment_intent.succeeded": {
        // Optional: you can also reconcile here if needed.
        break;
      }

      default:
        // No-op for other events, but respond 200 so Stripe stops retrying.
        break;
    }

    return json({ received: true }, 200);
  } catch (e) {
    console.error("[stripe-webhook] unhandled error:", e);
    return json({ error: e?.message || "webhook failure" }, 500);
  }
};
