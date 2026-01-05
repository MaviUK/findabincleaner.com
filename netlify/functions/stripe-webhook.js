import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req) {
  const sig = req.headers["stripe-signature"];
  const body = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return json({ error: err.message }, 400);
  }

  const type = event.type;
  const obj = event.data.object;

  console.log("[webhook]", type, "id=", event.id);

  try {
    // ================================
    // 1️⃣ CHECKOUT COMPLETED (DECISION POINT)
    // ================================
    if (type === "checkout.session.completed") {
      const session = obj;

      const subscriptionId = session.subscription;
      const metadata = session.metadata;

      const {
        business_id,
        area_id,
        category_id,
        slot,
      } = metadata;

      // 🔑 Get REMAINING geometry (NOT full polygon)
      const { data: rem, error: remErr } =
        await sb.rpc("area_remaining_preview_internal", {
          p_area_id: area_id,
          p_category_id: category_id,
          p_slot: Number(slot),
        });

      if (remErr) throw remErr;

      // 🚫 Nothing left → cancel immediately
      if (!rem || rem.sold_out || !rem.geojson) {
        await cancelAndCleanup(subscriptionId, "no_remaining_or_overlap");
        return json({ ok: true, canceled: true }, 200);
      }

      // ✅ Valid → upsert sponsored row with REMAINING GEOM
      await upsertSponsoredRow({
        business_id,
        area_id,
        category_id,
        slot: Number(slot),
        stripe_customer_id: session.customer,
        stripe_subscription_id: subscriptionId,
        unit_amount_pennies: session.amount_total,
        currency: session.currency,
        status: "active",
        current_period_end_iso: null,
        sponsored_geom_ewkt: rem.ewkt, // 🔥 THIS MUST BE REMAINING
      });

      return json({ ok: true, activated: true }, 200);
    }

    // ================================
    // 2️⃣ SUBSCRIPTION UPDATED
    // ================================
    if (type === "customer.subscription.updated") {
      const sub = obj;

      await sb
        .from("sponsored_subscriptions")
        .update({
          status: sub.status,
          current_period_end: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
        })
        .eq("stripe_subscription_id", sub.id);

      return json({ ok: true }, 200);
    }

    // ================================
    // 3️⃣ SUBSCRIPTION DELETED (CRITICAL FIX)
    // ================================
    if (type === "customer.subscription.deleted") {
      const sub = obj;

      await sb
        .from("sponsored_subscriptions")
        .update({
          status: "canceled",
          sponsored_geom: null, // 🔑 RELEASE THE AREA
          current_period_end: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
        })
        .eq("stripe_subscription_id", sub.id);

      return json({ ok: true, cleaned_up: true }, 200);
    }

    // ================================
    // IGNORE OTHERS
    // ================================
    return json({ ok: true, ignored: true }, 200);

  } catch (err) {
    console.error("[webhook] error", err);
    return json({ error: err.message }, 500);
  }
}
