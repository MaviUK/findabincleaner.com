// netlify/functions/sponsored-upgrade.js

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// JSON helper
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// statuses that we consider “active enough” to allow expansion
const BLOCKING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);

const EPS = 1e-6;

export default async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const businessId = String(body.businessId || body.cleanerId || "").trim();
  const areaId = String(body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot || 1);

  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);
  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (![1].includes(slot))
    return json({ ok: false, error: "Invalid slot" }, 400);

  try {
    //
    // 1) Fetch existing sponsored_subscriptions row for this business+area+slot
    //
    const { data: sub, error: subErr } = await sb
      .from("sponsored_subscriptions")
      .select(
        "id, business_id, area_id, slot, status, area_km2, price_cents, stripe_subscription_id"
      )
      .eq("business_id", businessId)
      .eq("area_id", areaId)
      .eq("slot", slot)
      .maybeSingle();

    if (subErr) throw subErr;

    if (!sub) {
      return json(
        {
          ok: false,
          code: "no_subscription",
          message: "No existing sponsorship found to upgrade.",
        },
        409
      );
    }

    const status = String(sub.status || "").toLowerCase();
    if (!BLOCKING.has(status)) {
      return json(
        {
          ok: false,
          code: "inactive_subscription",
          message: "Sponsorship is not active and cannot be upgraded.",
        },
        409
      );
    }

    if (!sub.stripe_subscription_id) {
      return json(
        {
          ok: false,
          code: "missing_stripe_subscription_id",
          message: "Stripe subscription ID is missing for this sponsorship.",
        },
        500
      );
    }

    const current_area_km2 = Number(sub.area_km2 ?? 0) || 0;
    const current_price_cents = Number(sub.price_cents ?? 0) || 0;

    //
    // 2) Call area_remaining_preview to find EXTRA free area we can add now
    //
    const { data: previewRow, error: prevErr } = await sb.rpc(
      "area_remaining_preview",
      {
        p_area_id: areaId,
        p_slot: slot,
      }
    );
    if (prevErr) throw prevErr;

    const row = Array.isArray(previewRow)
      ? previewRow[0] || {}
      : previewRow || {};

    const available_km2 =
      Number(row.available_km2 ?? row.area_km2 ?? 0) || 0;

    // This is the extra new area we’d be adding on top of what they already own
    const extra_area_km2 = Math.max(0, available_km2);
    const new_total_area_km2 = current_area_km2 + extra_area_km2;

    if (extra_area_km2 <= EPS) {
      return json(
        {
          ok: false,
          code: "no_extra",
          message: "No additional purchasable area available to upgrade.",
        },
        409
      );
    }

    //
    // 3) Work out the NEW price from the NEW total area
    //
    const rate_per_km2 =
      Number(
        process.env.RATE_GOLD_PER_KM2_PER_MONTH ??
          process.env.RATE_PER_KM2_PER_MONTH ??
          0
      ) || 0;

    const new_price_cents = Math.max(
      1,
      Math.round(new_total_area_km2 * rate_per_km2 * 100)
    );

    //
    // 4) Update the Stripe subscription to the NEW price, for next billing period
    //
    const subscription = await stripe.subscriptions.retrieve(
      sub.stripe_subscription_id
    );

    const item = subscription.items.data[0];
    if (!item) {
      return json(
        {
          ok: false,
          code: "no_subscription_item",
          message: "Subscription has no items to update.",
        },
        500
      );
    }

    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      items: [
        {
          id: item.id,
          price_data: {
            currency: "gbp",
            product: item.price.product, // reuse the same product
            unit_amount: new_price_cents,
            recurring: { interval: "month" },
          },
        },
      ],
      // 🔑 Only change price from next billing date, with no proration
      proration_behavior: "none",
      billing_cycle_anchor: "unchanged",
    });

    //
    // 5) Update our own DB with the new area + price
    //
    const { error: updErr } = await sb
      .from("sponsored_subscriptions")
      .update({
        area_km2: new_total_area_km2,
        price_cents: new_price_cents,
      })
      .eq("id", sub.id);

    if (updErr) throw updErr;

    return json({
      ok: true,
      current_area_km2,
      extra_area_km2,
      new_total_area_km2,
      current_price_cents,
      new_price_cents,
    });
  } catch (e) {
    console.error("sponsored-upgrade error:", e);
    return json(
      { ok: false, error: e?.message || "Server error in sponsored-upgrade" },
      500
    );
  }
};
