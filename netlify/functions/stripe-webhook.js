// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

console.log("LOADED stripe-webhook v2026-01-03-GEOM-SAFE+OVERLAP-GRACE");

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
  const { data, error } = await supabase
    .from("sponsored_locks")
    .select("final_geojson")
    .eq("id", lockId)
    .maybeSingle();

  if (error) {
    console.warn("[webhook] getLockGeoJSON error:", error);
    return null;
  }

  return data?.final_geojson ?? null;
}

/**
 * ✅ Single DB entry-point that guarantees geometry.
 * Uses lock.final_geojson when present; otherwise DB function will fallback to clipped preview geometry.
 */
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
    p_price_monthly_pennies: Number(price_monthly_pennies ?? 0) || 0,
    p_currency: (currency || "gbp")?.toLowerCase(),
    p_status: status || "active",
    p_current_period_end: current_period_end ?? null,
    p_final_geojson: final_geojson,
  });

  if (error) throw error;
  return data;
}

function safeStr(x) {
  return (x ?? "").toString();
}

function safeInt(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
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
      /**
       * ✅ Primary source of truth:
       * - session.metadata contains business_id/area_id/category_id/slot/lock_id
       * - session.subscription + session.customer are present
       */
      case "checkout.session.completed": {
        const session = event.data.object;
        const meta = session.metadata || {};

        const lock_id = meta.lock_id || null;

        const business_id =
          meta.business_id || meta.cleaner_id || meta.cleanerId || meta.businessId || null;
        const area_id = meta.area_id || meta.areaId || null;
        const category_id = meta.category_id || meta.categoryId || null;
        const slot = safeInt(meta.slot, 1);

        // If any of these are missing, we still want to release lock (if any),
        // but we cannot persist a subscription row.
        if (!business_id || !area_id || !category_id) {
          console.warn("[webhook] checkout.session.completed missing metadata", {
            business_id,
            area_id,
            category_id,
            slot,
            lock_id,
          });
          await releaseLockSafe(lock_id);
          break;
        }

        const stripe_subscription_id = session.subscription ? safeStr(session.subscription) : null;
        const stripe_customer_id = session.customer ? safeStr(session.customer) : null;

        if (!stripe_subscription_id || !stripe_customer_id) {
          console.warn("[webhook] checkout.session.completed missing subscription/customer", {
            stripe_subscription_id,
            stripe_customer_id,
            lock_id,
          });
          await releaseLockSafe(lock_id);
          break;
        }

        // Pull subscription for status + current_period_end
        const sub = await stripe.subscriptions.retrieve(stripe_subscription_id);

        const current_period_end = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;

        // Prefer actual price from metadata if you set it, otherwise fallback 0 (postverify will set correct)
        const price_monthly_pennies = safeInt(meta.price_pennies, 0);

        try {
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
        } catch (e) {
          const msg = e?.message || "";

          // ✅ Do NOT fail the webhook for overlap conflicts — payment already happened.
          if (msg.includes("overlaps an existing sponsored area") || msg.includes("Area overlaps")) {
            console.warn("[webhook] overlap prevented DB write; lock will be released.", {
              business_id,
              area_id,
              category_id,
              slot,
              stripe_subscription_id,
            });
          } else if (msg.includes("sold out")) {
            console.warn("[webhook] sold out prevented DB write; lock will be released.", {
              business_id,
              area_id,
              category_id,
              slot,
              stripe_subscription_id,
            });
          } else {
            throw e;
          }
        }

        await releaseLockSafe(lock_id);
        break;
      }

      /**
       * ✅ If checkout session expires, release lock.
       */
      case "checkout.session.expired": {
        const session = event.data.object;
        const lock_id = session?.metadata?.lock_id || null;
        await releaseLockSafe(lock_id);
        break;
      }

      /**
       * ✅ Keep status/period_end in sync WITHOUT creating new rows.
       * We only update existing rows by stripe_subscription_id.
       */
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const stripe_subscription_id = sub.id;

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

      case "customer.subscription.created": {
        // Optional: you may log, but do not create rows here unless you have metadata.
        // This event often fires without area/category/business metadata.
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
