// netlify/functions/sponsored-checkout.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

function toPence(gbp) {
  const n = Number(gbp);
  return Math.round(Number.isFinite(n) ? n * 100 : 0);
}
function readNum(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : fallback;
}
function tierRates(slot) {
  switch (Number(slot)) {
    case 1:
      return {
        rate: readNum("RATE_GOLD_PER_KM2_PER_MONTH", readNum("RATE_PER_KM2_PER_MONTH", 15)),
        min:  readNum("MIN_GOLD_PRICE_PER_MONTH",  readNum("MIN_PRICE_PER_MONTH", 1)),
        label: "Gold",
      };
    case 2:
      return {
        rate: readNum("RATE_SILVER_PER_KM2_PER_MONTH", readNum("RATE_PER_KM2_PER_MONTH", 12)),
        min:  readNum("MIN_SILVER_PRICE_PER_MONTH",  readNum("MIN_PRICE_PER_MONTH", 0.75)),
        label: "Silver",
      };
    case 3:
      return {
        rate: readNum("RATE_BRONZE_PER_KM2_PER_MONTH", readNum("RATE_PER_KM2_PER_MONTH", 10)),
        min:  readNum("MIN_BRONZE_PRICE_PER_MONTH",  readNum("MIN_PRICE_PER_MONTH", 0.5)),
        label: "Bronze",
      };
    default:
      return {
        rate: readNum("RATE_PER_KM2_PER_MONTH", 15),
        min:  readNum("MIN_PRICE_PER_MONTH", 1),
        label: "Unknown",
      };
  }
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function siteBase() {
  return (process.env.PUBLIC_SITE_URL || "http://localhost:5173").replace(/\/+$/, "");
}

async function hasExistingSponsorship(business_id, area_id, slot) {
  try {
    const { data, error } = await supabase
      .from("sponsored_subscriptions")
      .select("id,status,stripe_subscription_id,stripe_payment_intent_id")
      .eq("business_id", business_id)
      .eq("area_id", area_id)
      .eq("slot", Number(slot))
      .limit(1);
    if (error || !data?.length) return false;
    const row = data[0];
    const active = new Set(["active","trialing","past_due","unpaid","incomplete","incomplete_expired"]);
    return active.has(row.status) || Boolean(row.stripe_payment_intent_id);
  } catch {
    return false;
  }
}

async function ensureStripeCustomerForCleaner(cleanerId) {
  const { data: cleaner, error } = await supabase
    .from("cleaners")
    .select("id,business_name,stripe_customer_id,user_id")
    .eq("id", cleanerId)
    .maybeSingle();
  if (error) throw error;
  if (!cleaner) throw new Error("Cleaner not found");
  if (cleaner.stripe_customer_id) return cleaner.stripe_customer_id;

  let email = null;
  if (cleaner.user_id) {
    const { data: p } = await supabase.from("profiles").select("email").eq("id", cleaner.user_id).maybeSingle();
    email = p?.email || null;
  }

  let stripeCustomerId = null;
  if (email) {
    const list = await stripe.customers.list({ email, limit: 1 });
    if (list.data.length) stripeCustomerId = list.data[0].id;
  }
  if (!stripeCustomerId) {
    const created = await stripe.customers.create({
      email: email || undefined,
      name: cleaner.business_name || undefined,
      metadata: { cleaner_id: cleanerId },
    });
    stripeCustomerId = created.id;
  }
  await supabase.from("cleaners").update({ stripe_customer_id: stripeCustomerId }).eq("id", cleanerId);
  return stripeCustomerId;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { cleanerId, areaId, slot, months = 1, drawnGeoJSON } = await req.json();
    if (!cleanerId || !areaId || !slot) return json({ error: "cleanerId, areaId, slot required" }, 400);

    if (await hasExistingSponsorship(cleanerId, areaId, slot)) {
      return json({ error: "You already have an active/prepaid sponsorship for this slot." }, 409);
    }

    // Area for this slot
    const { data, error } = await supabase.rpc("get_area_preview", {
      _area_id: areaId,
      _slot: Number(slot),
      _drawn_geojson: drawnGeoJSON ?? null,
      _exclude_cleaner: null,
    });
    if (error) {
      console.error("[checkout] get_area_preview error:", error);
      return json({ error: "Failed to compute area/price" }, 500);
    }
    const area_km2 = Number((Array.isArray(data) ? data[0]?.area_km2 : data?.area_km2) ?? 0);

    // Tiered pricing
    const { rate, min, label } = tierRates(slot);
    const monthly_price = Math.max(min, Math.max(0, area_km2) * rate);
    const unit_amount = toPence(monthly_price);

    const customerId = await ensureStripeCustomerForCleaner(cleanerId);
    const site = siteBase();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            unit_amount,
            recurring: { interval: "month", interval_count: 1 },
            product_data: {
              name: `${label} area sponsorship #${slot}`,
              description: `Area: ${area_km2.toFixed(4)} km² • £${monthly_price.toFixed(2)}/month`,
            },
          },
          quantity: 1,
        },
      ],
      subscription_data: {
        metadata: {
          cleaner_id: cleanerId,
          area_id: areaId,
          slot: String(slot),
          tier: label,
          area_km2: area_km2.toFixed(6),
          monthly_price_pennies: String(unit_amount),
          months_requested: String(Math.max(1, Number(months))),
        },
      },
      metadata: { cleaner_id: cleanerId, area_id: areaId, slot: String(slot), tier: label },
      success_url: `${site}/#/dashboard?checkout=success&checkout_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/#/dashboard?checkout=cancel`,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("[checkout] error:", e);
    return json({ error: e?.message || "checkout failed" }, 500);
  }
};
