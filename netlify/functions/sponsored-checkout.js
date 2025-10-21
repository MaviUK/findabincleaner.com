// netlify/functions/sponsored-checkout.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const RATE = {
  1: Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? 1),
  2: Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH ?? 0.75),
  3: Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH ?? 0.5),
};
const MIN = {
  1: Number(process.env.MIN_GOLD_PRICE_PER_MONTH ?? 1),
  2: Number(process.env.MIN_SILVER_PRICE_PER_MONTH ?? 0.75),
  3: Number(process.env.MIN_BRONZE_PRICE_PER_MONTH ?? 0.5),
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const toPence = (gbp) => Math.round(Math.max(0, Number(gbp)) * 100);
const siteBase = () =>
  (process.env.PUBLIC_SITE_URL ||
    process.env.DEPLOY_PRIME_URL || // Netlify preview env
    process.env.URL ||              // Netlify production env
    "http://localhost:8888"
  ).replace(/\/+$/, "");

// Duplicate guard for SAME business/area/slot
async function hasExistingSponsorship(business_id, area_id, slot) {
  try {
    const { data } = await supabase
      .from("sponsored_subscriptions")
      .select("id,status,stripe_subscription_id,stripe_payment_intent_id")
      .eq("business_id", business_id)
      .eq("area_id", area_id)
      .eq("slot", Number(slot))
      .limit(1);
    if (!data?.length) return false;
    const row = data[0];
    const activeish = new Set([
      "active", "trialing", "past_due", "unpaid", "incomplete", "incomplete_expired",
    ]);
    return activeish.has(row.status) || Boolean(row.stripe_payment_intent_id);
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
    const { data: profile } = await supabase
      .from("profiles")
      .select("email").eq("id", cleaner.user_id).maybeSingle();
    email = profile?.email || null;
  }

  // Reuse by email if found
  let customerId = null;
  if (email) {
    const list = await stripe.customers.list({ email, limit: 1 });
    if (list.data.length) customerId = list.data[0].id;
  }
  if (!customerId) {
    const created = await stripe.customers.create({
      email: email || undefined,
      name: cleaner.business_name || undefined,
      metadata: { cleaner_id: cleanerId },
    });
    customerId = created.id;
  }
  await supabase.from("cleaners").update({ stripe_customer_id: customerId }).eq("id", cleanerId);
  return customerId;
}

// Authoritative re-check using the same logic as the UI preview
async function serverPreview(cleanerId, areaId, slot) {
  const base = siteBase();
  const res = await fetch(`${base}/.netlify/functions/sponsored-preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cleanerId, areaId, slot }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`preview ${res.status}${txt ? ` – ${txt}` : ""}`);
  }
  const json = await res.json();
  if (!json?.ok) throw new Error(json?.error || "Preview failed");
  const km2 = Number(json.area_km2);
  const monthly = Number(json.monthly_price);
  return {
    km2: Number.isFinite(km2) ? km2 : 0,
    monthly: Number.isFinite(monthly) ? monthly : null,
  };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { cleanerId, areaId, slot } = await req.json();
    if (!cleanerId || !areaId || ![1, 2, 3].includes(Number(slot))) {
      return json({ error: "cleanerId, areaId, slot required" }, 400);
    }

    if (await hasExistingSponsorship(cleanerId, areaId, slot)) {
      return json({ error: "You already have an active/prepaid sponsorship for this slot." }, 409);
    }

    // >>> Reuse preview logic (this is what fixed Slot #2)
    const { km2, monthly } = await serverPreview(cleanerId, areaId, Number(slot));
    if (!Number.isFinite(km2) || km2 <= 0) {
      return json({ error: `Sponsor #${slot} is already fully taken in this area.` }, 409);
    }

    // If preview returned a monthly value, trust it; otherwise compute from env
    const computedMonthly = monthly ?? Math.max((MIN[slot] ?? 1), km2 * (RATE[slot] ?? 1));
    const unitAmount = toPence(computedMonthly);

    const customerId = await ensureStripeCustomerForCleaner(cleanerId);
    const site = siteBase();
    const tierName = Number(slot) === 1 ? "Gold" : Number(slot) === 2 ? "Silver" : "Bronze";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            unit_amount: unitAmount,
            recurring: { interval: "month", interval_count: 1 },
            product_data: {
              name: `Area sponsorship #${slot} (${tierName})`,
              description: `Available area: ${km2.toFixed(4)} km² • £${(unitAmount/100).toFixed(2)}/month`,
            },
          },
          quantity: 1,
        },
      ],
      subscription_data: {
        metadata: {
          cleaner_id: String(cleanerId),
          area_id: String(areaId),
          slot: String(slot),
          available_area_km2: km2.toFixed(6),
          monthly_price_pennies: String(unitAmount),
          tier: tierName,
        },
      },
      metadata: {
        cleaner_id: String(cleanerId),
        area_id: String(areaId),
        slot: String(slot),
      },
      success_url: `${site}/#/dashboard?checkout=success&checkout_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/#/dashboard?checkout=cancel`,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("[checkout] error:", e);
    return json({ error: e?.message || "checkout failed" }, 500);
  }
};
