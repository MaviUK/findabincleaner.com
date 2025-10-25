// netlify/functions/sponsored-checkout.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const readNum = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
};
const RATE_DEFAULT = readNum("RATE_PER_KM2_PER_MONTH", 15);
const MIN_DEFAULT  = readNum("MIN_PRICE_PER_MONTH", 1);
const RATE = {
  1: readNum("RATE_GOLD_PER_KM2_PER_MONTH", RATE_DEFAULT),
  2: readNum("RATE_SILVER_PER_KM2_PER_MONTH", RATE_DEFAULT),
  3: readNum("RATE_BRONZE_PER_KM2_PER_MONTH", RATE_DEFAULT),
};
const MIN = {
  1: readNum("MIN_GOLD_PRICE_PER_MONTH", MIN_DEFAULT),
  2: readNum("MIN_SILVER_PRICE_PER_MONTH", MIN_DEFAULT),
  3: readNum("MIN_BRONZE_PRICE_PER_MONTH", MIN_DEFAULT),
};
const toPence = (gbp) => Math.round(Math.max(0, Number(gbp)) * 100);
const siteBase = () => (process.env.PUBLIC_SITE_URL || "http://localhost:5173").replace(/\/+$/, "");

const ACTIVEISH = new Set([
  "active", "trialing", "past_due", "unpaid", "incomplete", "incomplete_expired",
]);

async function hasExistingSponsorshipForSameBusiness(business_id, area_id, slot) {
  const { data, error } = await supabase
    .from("sponsored_subscriptions")
    .select("id,status,stripe_payment_intent_id")
    .eq("business_id", business_id)
    .eq("area_id", area_id)
    .eq("slot", Number(slot))
    .limit(1);
  if (error) {
    console.error("[checkout] duplicate guard error:", error);
    return false;
  }
  if (!data?.length) return false;
  const row = data[0];
  return ACTIVEISH.has(row.status) || Boolean(row.stripe_payment_intent_id);
}

async function ensureStripeCustomerForBusiness(businessId) {
  const { data: cleaner, error } = await supabase
    .from("cleaners")
    .select("id,business_name,stripe_customer_id,user_id")
    .eq("id", businessId)
    .maybeSingle();
  if (error) throw error;
  if (!cleaner) throw new Error("Business not found");
  if (cleaner.stripe_customer_id) return cleaner.stripe_customer_id;

  let email = null;
  if (cleaner.user_id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", cleaner.user_id)
      .maybeSingle();
    email = profile?.email || null;
  }

  let customerId = null;
  if (email) {
    const list = await stripe.customers.list({ email, limit: 1 });
    if (list.data.length) customerId = list.data[0].id;
  }
  if (!customerId) {
    const created = await stripe.customers.create({
      email: email || undefined,
      name: cleaner.business_name || undefined,
      metadata: { business_id: businessId },
    });
    customerId = created.id;
  }
  await supabase.from("cleaners").update({ stripe_customer_id: customerId }).eq("id", businessId);
  return customerId;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const businessId = body.businessId || body.cleanerId; // same UUID in your app
    const areaId = body.areaId || body.area_id;
    const slot = Number(body.slot);

    if (!businessId || !areaId || ![1, 2, 3].includes(slot)) {
      return json({ error: "businessId/cleanerId, areaId, slot required" }, 400);
    }

    // Prevent duplicates by the same business
    if (await hasExistingSponsorshipForSameBusiness(businessId, areaId, slot)) {
      return json({ error: "You already have an active/prepaid sponsorship for this slot." }, 409);
    }

    // Compute the truly purchasable sub-region (authoritative)
    const { data, error } = await supabase.rpc("get_area_preview", {
      _area_id: areaId,
      _slot: slot,
      _drawn_geojson: null,
      _exclude_cleaner: null,
    });
    if (error) {
      console.error("[sponsored-checkout] get_area_preview error:", error);
      return json({ error: "Failed to compute available area" }, 500);
    }

    const row = Array.isArray(data) ? data[0] : data;
    const area_km2 = Number(row?.area_km2 ?? 0);
    if (!Number.isFinite(area_km2)) {
      console.error("[sponsored-checkout] invalid area_km2 payload:", row);
      return json({ error: "Failed to compute available area" }, 500);
    }
    if (area_km2 <= 0) {
      return json({ error: `This slot has no purchasable area left.` }, 409);
    }

    const rate = RATE[slot] ?? RATE_DEFAULT;
    const min  = MIN[slot]  ?? MIN_DEFAULT;
    const monthly_price = Math.max(min, Math.max(0, area_km2) * rate);
    const unit_amount   = toPence(monthly_price);

    const customerId = await ensureStripeCustomerForBusiness(businessId);
    const site = siteBase();
    const tierName = slot === 1 ? "Gold" : slot === 2 ? "Silver" : "Bronze";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            unit_amount: unit_amount,
            recurring: { interval: "month", interval_count: 1 },
            product_data: {
              name: `Area sponsorship #${slot} (${tierName})`,
              description: `Available area: ${area_km2.toFixed(4)} km² • £${monthly_price.toFixed(2)}/month`,
            },
          },
          quantity: 1,
        },
      ],
      subscription_data: {
        metadata: {
          business_id: String(businessId),
          area_id: String(areaId),
          slot: String(slot),
          available_area_km2: area_km2.toFixed(6),
          monthly_price_pennies: String(unit_amount),
          tier: tierName,
        },
      },
      metadata: {
        business_id: String(businessId),
        area_id: String(areaId),
        slot: String(slot),
      },
      success_url: `${site}/#/dashboard?checkout=success&checkout_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/#/dashboard?checkout=cancel`,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("[sponsored-checkout] fatal:", e);
    return json({ error: e?.message || "checkout failed" }, 500);
  }
};
