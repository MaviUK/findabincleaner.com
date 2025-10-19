// netlify/functions/sponsored-checkout.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

// ---------- pricing helpers (per slot 1/2/3) ----------
function toPence(gbpNumber) {
  const n = Number(gbpNumber);
  return Math.round(Number.isFinite(n) ? n * 100 : 0);
}
function readNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : fallback;
}
function readFirstEnvNumber(names, fallback) {
  for (const n of names) {
    const v = readNumberEnv(n, Number.NaN);
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}
function getSlotConfig(slot) {
  if (slot === 1) {
    return {
      rate: readFirstEnvNumber(
        ["RATE_SLOT1_PER_KM2_PER_MONTH", "RATE_GOLD_PER_KM2_PER_MONTH", "RATE_PER_KM2_PER_MONTH"],
        15
      ),
      min: readFirstEnvNumber(
        ["MIN_SLOT1_PRICE_PER_MONTH", "MIN_GOLD_PRICE_PER_MONTH", "MIN_PRICE_PER_MONTH"],
        5
      ),
      label: "Gold",
    };
  }
  if (slot === 2) {
    return {
      rate: readFirstEnvNumber(
        ["RATE_SLOT2_PER_KM2_PER_MONTH", "RATE_SILVER_PER_KM2_PER_MONTH", "RATE_PER_KM2_PER_MONTH"],
        10
      ),
      min: readFirstEnvNumber(
        ["MIN_SLOT2_PRICE_PER_MONTH", "MIN_SILVER_PRICE_PER_MONTH", "MIN_PRICE_PER_MONTH"],
        4
      ),
      label: "Silver",
    };
  }
  return {
    rate: readFirstEnvNumber(
      ["RATE_SLOT3_PER_KM2_PER_MONTH", "RATE_BRONZE_PER_KM2_PER_MONTH", "RATE_PER_KM2_PER_MONTH"],
      7
    ),
    min: readFirstEnvNumber(
      ["MIN_SLOT3_PRICE_PER_MONTH", "MIN_BRONZE_PRICE_PER_MONTH", "MIN_PRICE_PER_MONTH"],
      3
    ),
    label: "Bronze",
  };
}
function computeMonthly(areaKm2, slot) {
  const { rate, min } = getSlotConfig(slot);
  const raw = Math.max(0, Number(areaKm2)) * rate;
  return Math.max(min, raw);
}

// ---------- utils ----------
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function siteBase() {
  return (process.env.PUBLIC_SITE_URL || "http://localhost:5173").replace(/\/+$/, "");
}

// Prevent duplicate purchases for same business/area/slot (best effort)
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
    const active = new Set([
      "active",
      "trialing",
      "past_due",
      "unpaid",
      "incomplete",
      "incomplete_expired",
    ]);
    return active.has(row.status) || Boolean(row.stripe_payment_intent_id);
  } catch {
    return false;
  }
}

// Ensure a single Stripe Customer per cleaner and store on cleaners.stripe_customer_id
async function ensureStripeCustomerForCleaner(cleanerId) {
  const { data: cleaner, error: cleanerErr } = await supabase
    .from("cleaners")
    .select("id, business_name, stripe_customer_id, user_id")
    .eq("id", cleanerId)
    .maybeSingle();

  if (cleanerErr) throw cleanerErr;
  if (!cleaner) throw new Error("Cleaner not found");

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

// ---------- handler ----------
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const {
      cleanerId,
      areaId,
      slot,
      months = 1,      // informational only (recurring monthly charge)
      drawnGeoJSON,    // optional override shape
    } = await req.json();

    const slotNum = Number(slot);
    if (!cleanerId || !areaId || !slotNum) {
      return json({ error: "cleanerId, areaId, slot required" }, 400);
    }
    if (![1, 2, 3].includes(slotNum)) {
      return json({ error: "Invalid slot (1|2|3)" }, 400);
    }

    // Prevent duplicate purchase
    if (await hasExistingSponsorship(cleanerId, areaId, slotNum)) {
      return json({ error: "You already have an active/prepaid sponsorship for this slot." }, 409);
    }

    // Compute area using the same preview RPC (works for saved area or drawn geometry)
    const { data, error } = await supabase.rpc("get_area_preview", {
      _area_id: areaId,
      _slot: slotNum,
      _drawn_geojson: drawnGeoJSON ?? null,
      _exclude_cleaner: cleanerId,
    });
    if (error) {
      console.error("[checkout] get_area_preview error:", error);
      return json({ error: "Failed to compute area/price" }, 500);
    }
    const area_km2 = Number((Array.isArray(data) ? data[0]?.area_km2 : data?.area_km2) ?? 0);

    const monthly_price = computeMonthly(area_km2, slotNum);
    const unit_amount = toPence(monthly_price);
    const tier = getSlotConfig(slotNum).label;

    // Get/reuse Customer
    const customerId = await ensureStripeCustomerForCleaner(cleanerId);
    const site = siteBase();

    // Create Subscription Checkout
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
              name: `Area sponsorship (${tier}) #${slotNum}`,
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
          slot: String(slotNum),
          tier,
          area_km2: area_km2.toFixed(6),
          monthly_price_pennies: String(unit_amount),
          months_requested: String(Math.max(1, Number(months))),
        },
      },
      metadata: {
        cleaner_id: cleanerId,
        area_id: areaId,
        slot: String(slotNum),
        tier,
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
