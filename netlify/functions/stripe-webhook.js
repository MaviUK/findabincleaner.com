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

  await supabase.from("sponsored_subscriptions").upsert(row, {
    onConflict: "stripe_checkout_id",
  });
}

export default async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const sig = req.headers.get("stripe-signature");
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!sig || !secret) return json({ error: "Missing signature/secret" }, 400);

    // IMPORTANT: Use RAW BODY
    const raw = await req.text();

    let event;
    try {
      event = stripe.webhooks.constructEvent(raw, sig, secret);
    } catch (err) {
      console.error("[webhook] signature error:", err);
      return json({ error: `Signature verification failed: ${err.message}` }, 400);
    }

    switch (event.type) {
      case "checkout.session.completed": {
        await upsertFromCheckoutSession(event.data.object);
        break;
      }
      // You can add invoice.paid / payment_intent.succeeded handlers here if needed.
      default:
        break;
    }

    return json({ received: true }, 200);
  } catch (e) {
    console.error("[webhook] unhandled error:", e);
    return json({ error: e?.message || "webhook failure" }, 500);
  }
};
