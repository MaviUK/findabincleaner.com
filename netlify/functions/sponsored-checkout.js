// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));

    const { businessId, areaId, slot = 1, priceCents } = body;

    if (!businessId || !areaId || priceCents == null) {
      return json(
        { ok: false, error: "Missing businessId, areaId or priceCents" },
        400
      );
    }

    // 1. Load business profile from `profiles` (no email column used)
    const { data: profile, error: profileErr } = await sb
      .from("profiles")
      .select("id, stripe_customer_id")
      .eq("id", businessId)
      .maybeSingle();

    if (profileErr) {
      console.error("profileErr:", profileErr);
    }

    if (!profile) {
      return json(
        {
          ok: false,
          error: "Business profile not found",
        },
        400
      );
    }

    // 2. Ensure Stripe customer
    let stripeCustomerId = profile.stripe_customer_id ?? null;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        metadata: {
          supabase_business_id: profile.id,
        },
      });

      stripeCustomerId = customer.id;

      await sb
        .from("profiles")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", profile.id);
    }

    // 3. Normalise price (in pence)
    const unitAmount =
      typeof priceCents === "number"
        ? Math.round(priceCents)
        : Math.round(Number(priceCents) || 0);

    if (!unitAmount || unitAmount <= 0) {
      return json(
        { ok: false, error: "Invalid price for checkout session" },
        400
      );
    }

    // 4. Create Stripe Checkout session for a subscription
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            unit_amount: unitAmount,
            recurring: { interval: "month" },
            product_data: {
              name: "Featured area sponsorship",
              metadata: {
                supabase_business_id: profile.id,
                supabase_area_id: areaId,
                slot: String(slot),
              },
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=success`,
      cancel_url: `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=cancel`,
      metadata: {
        business_id: profile.id,
        area_id: areaId,
        slot: String(slot),
      },
    });

    return json({ ok: true, url: session.url }, 200);
  } catch (e) {
    console.error("sponsored-checkout error:", e);
    return json(
      { ok: false, error: e?.message || "Server error in checkout" },
      500
    );
  }
};
