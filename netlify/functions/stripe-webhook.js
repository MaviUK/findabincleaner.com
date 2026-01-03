// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

console.log("LOADED stripe-webhook v2026-01-03 LOCK-RELEASE+CATEGORY");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

async function releaseLockSafe(lockId) {
  if (!lockId) return;
  try {
    await supabase.from("sponsored_locks").update({ is_active: false }).eq("id", lockId);
  } catch (e) {
    console.error("[webhook] failed to release lock:", lockId, e?.message || e);
  }
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) return json({ ok: false, error: "Missing STRIPE_WEBHOOK_SECRET" }, 500);
  if (!sig) return json({ ok: false, error: "Missing stripe-signature" }, 400);

  let event;
  try {
    const rawBody = await req.text();
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (e) {
    console.error("[stripe-webhook] signature verify failed:", e?.message || e);
    return json({ ok: false, error: "Invalid signature" }, 400);
  }

  try {
    // We rely on metadata for lock_id + business/area/category.
    // Your sponsored-checkout sets these on the Checkout Session.
    switch (event.type) {
      case "checkout.session.completed": {
        // Payment completed (session completes). Your app also calls stripe-postverify from the client.
        // We can release lock here as well (safe).
        const session = event.data.object;
        const meta = session.metadata || {};
        const lockId = meta.lock_id || null;

        await releaseLockSafe(lockId);
        break;
      }

      case "checkout.session.expired": {
        // User abandoned checkout
        const session = event.data.object;
        const meta = session.metadata || {};
        const lockId = meta.lock_id || null;

        await releaseLockSafe(lockId);
        break;
      }

      case "customer.subscription.deleted": {
        // optional: if subscription canceled, you might want to set sponsored_subscriptions.status = 'canceled'
        // This depends on your business rules.
        const sub = event.data.object;
        const stripeSubId = sub.id;

        await supabase
          .from("sponsored_subscriptions")
          .update({ status: "canceled", updated_at: new Date().toISOString() })
          .eq("stripe_subscription_id", stripeSubId);

        break;
      }

      case "customer.subscription.updated": {
        // keep status/current_period_end in sync (optional but recommended)
        const sub = event.data.object;
        const stripeSubId = sub.id;

        const status = sub.status || null;
        const currentPeriodEndIso = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;

        await supabase
          .from("sponsored_subscriptions")
          .update({
            status,
            current_period_end: currentPeriodEndIso,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", stripeSubId);

        break;
      }

      default:
        // ignore other events
        break;
    }

    return json({ ok: true });
  } catch (e) {
    console.error("[stripe-webhook] handler error:", e);
    return json({ ok: false, error: e?.message || "Webhook failed" }, 500);
  }
};
