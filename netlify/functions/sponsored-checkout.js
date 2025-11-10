// netlify/functions/sponsored-checkout.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const businessId = String(body.businessId || body.cleanerId || "").trim();
    const areaId = String(body.areaId || body.area_id || "").trim();
    const km2 = Number(body.preview_km2);

    if (!businessId || !areaId) {
      return json({ error: "Missing businessId or areaId" }, 400);
    }
    if (!Number.isFinite(km2) || km2 <= 0) {
      return json({ error: "No purchasable area available (preview_km2 <= 0)" }, 400);
    }

    // Pull rates from env with safe fallbacks so we never die with 0
    const rate =
      Number(process.env.RATE_PER_KM2_PER_MONTH) ||
      Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH) ||
      1; // £1 default

    const minMonthly =
      Number(process.env.MIN_PRICE_PER_MONTH) ||
      Number(process.env.MIN_GOLD_PRICE_PER_MONTH) ||
      1; // £1 default

    const raw = Math.max(0, km2 * rate);
    const monthlyMajor = Math.max(minMonthly, raw);
    const monthlyCents = Math.round(monthlyMajor * 100);
    if (!monthlyCents || monthlyCents <= 0) {
      return json({ error: "Calculated amount must be > 0" }, 400);
    }

    // ensure we have / create stripe customer for this business
    let customerId = null;
    const { data: biz, error: bizErr } = await sb
      .from("businesses")
      .select("stripe_customer_id")
      .eq("id", businessId)
      .maybeSingle();

    if (bizErr) console.warn("Fetch stripe_customer_id error:", bizErr);
    if (biz?.stripe_customer_id) {
      customerId = biz.stripe_customer_id;
    } else {
      const cust = await stripe.customers.create({ metadata: { business_id: businessId } });
      customerId = cust.id;
      await sb.from("businesses").update({ stripe_customer_id: customerId }).eq("id", businessId);
    }

    const site = process.env.PUBLIC_SITE_URL || "http://localhost:8888";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId || undefined,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: "Featured Sponsorship",
              description: "First in local search for this service area.",
            },
            recurring: { interval: "month" },
            unit_amount: monthlyCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${site}/#/dashboard?checkout=success`,
      cancel_url: `${site}/#/dashboard?checkout=cancel`,
      metadata: {
        business_id: businessId,
        area_id: areaId,
        preview_km2: String(km2),
      },
      allow_promotion_codes: true,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("sponsored-checkout error:", e);
    return json({ error: e?.message || "Server error" }, 500);
  }
};
