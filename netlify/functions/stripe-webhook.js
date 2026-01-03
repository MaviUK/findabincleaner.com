// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

console.log("LOADED stripe-webhook v2026-01-03-GEOM-SAFE");

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

async function getLockGeoJSON(lockId) {
  if (!lockId) return null;
  const { data } = await supabase
    .from("sponsored_locks")
    .select("final_geojson")
    .eq("id", lockId)
    .maybeSingle();
  return data?.final_geojson ?? null;
}

async function upsertSubWithGeom({
  business_id,
  area_id,
  category_id,
  slot,
  stripe_customer_id,
  stripe_subscription_id,
  price_monthly_pennies,
  currency,
  status,
  current_period_end,
  lock_id,
}) {
  const final_geojson = await getLockGeoJSON(lock_id);

  const { data, error } = await supabase.rpc("upsert_sponsored_subscription_with_geom", {
    p_business_id: business_id,
    p_area_id: area_id,
    p_category_id: category_id,
    p_slot: slot,
    p_stripe_customer_id: stripe_customer_id,
    p_stripe_subscription_id: stripe_subscription_id,
    p_price_monthly_pennies: price_monthly_pennies ?? 0,
    p_currency: (currency || "gbp")?.toLowerCase(),
    p_status: status,
    p_current_period_end: current_period_end ?? null,
    p_final_geojson: final_geojson,
  });

  if (error) throw error;
  return data;
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
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // Pull metadata from the checkout session (your sponsored-checkout sets these)
        const meta = session.metadata || {};
        const lock_id = meta.lock_id || null;

        const business_id =
          meta.business_id || meta.cleaner_id || meta.cleanerId || meta.businessId || null;
        const area_id = meta.area_id || meta.areaId || null;
        const category_id = meta.category_id || meta.categoryId || null;
        const slot = Number(meta.slot || 1);

        if (business_id && area_id && category_id && session.subscription && session.customer) {
          const stripe_subscription_id = String(session.subscription);
          const stripe_customer_id = String(session.customer);

          // safest: pull subscription for current_period_end + status
          const sub = await stripe.subscriptions.retrieve(stripe_subscription_id);
          const current_period_end = sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null;

          // best-effort price (if you store it elsewhere, update this)
          const price_monthly_pennies = Number(meta.price_pennies || 0) || 0;

          await upsertSubWithGeom({
            business_id,
            area_id,
            category_id,
            slot,
            stripe_customer_id,
            stripe_subscription_id,
            price_monthly_pennies,
            currency: session.currency || "gbp",
            status: sub.status || "active",
            current_period_end,
            lock_id,
          });
        }

        await releaseLockSafe(lock_id);
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object;
        const lock_id = session?.metadata?.lock_id || null;
        await releaseLockSafe(lock_id);
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const stripe_subscription_id = sub.id;

        // If you want: update status/period end even if metadata not available.
        // But DO NOT create new rows here unless you also know business/area/category.
        await supabase
          .from("sponsored_subscriptions")
          .update({
            status: sub.status || null,
            current_period_end: sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : null,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", stripe_subscription_id);

        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const stripe_subscription_id = sub.id;

        await supabase
          .from("sponsored_subscriptions")
          .update({ status: "canceled", updated_at: new Date().toISOString() })
          .eq("stripe_subscription_id", stripe_subscription_id);

        break;
      }

      default:
        break;
    }

    return json({ ok: true });
  } catch (e) {
    console.error("[stripe-webhook] handler error:", e);
    return json({ ok: false, error: e?.message || "Webhook failed" }, 500);
  }
};
