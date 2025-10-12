// netlify/functions/sponsored-checkout.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

// ---------------- helpers ----------------
const toPence = (gbp) => {
  const n = Number(gbp);
  return Math.round(Number.isFinite(n) ? n * 100 : 0);
};

const readNumberEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : fallback;
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const siteBase = () =>
  (process.env.PUBLIC_SITE_URL || "http://localhost:5173").replace(/\/+$/, "");

// Prevent duplicate sponsorship for same business/area/slot (best-effort)
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

// Ensure exactly one Stripe Customer per cleaner; store on cleaners.stripe_customer_id
async function ensureStripeCustomerForCleaner(cleanerId) {
  const { data: cleaner, error } = await supabase
    .from("cleaners")
    .select("id, business_name, stripe_customer_id, user_id")
    .eq("id", cleanerId)
    .maybeSingle();
  if (error) throw error;
  if (!cleaner) throw new Error("Cleaner not found");

  if (cleaner.stripe_customer_id) return cleaner.stripe_customer_id;

  // Fetch email from profiles
  let email = null;
  if (cleaner.user_id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", cleaner.user_id)
      .maybeSingle();
    email = profile?.email || null;
  }

  // Reuse an existing Stripe customer by email if possible
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

  await supabase
    .from("cleaners")
    .update({ stripe_customer_id: stripeCustomerId })
    .eq("id", cleanerId);

  return stripeCustomerId;
}

// ---------------- handler ----------------
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const {
      cleanerId,    // business_id (uuid)
      areaId,       // area_id (uuid)
      slot,         // 1 | 2 | 3
      months = 1,   // requested term (informational; subscription is monthly recurring)
      drawnGeoJSON, // optional; used in preview/price calc
    } = await req.json();

    if (!cleanerId || !areaId || !slot) {
      return json({ error: "cleanerId, areaId, slot required" }, 400);
    }

    // Best-effort duplicate guard
    if (await hasExistingSponsorship(cleanerId, areaId, slot)) {
      return json({ error: "You already have an active/prepaid sponsorship for this slot." }, 409);
    }

    // Server-side price calc / size check
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
    const RATE = readNumberEnv("RATE_PER_KM2_PER_MONTH", 15);
    const MIN  = readNumberEnv("MIN_PRICE_PER_MONTH", 1);

    if (!Number.isFinite(area_km2) || !Number.isFinite(RATE) || !Number.isFinite(MIN)) {
      return json(
        { error: "Pricing unavailable (check env vars & area size)", debug: { area_km2, RATE, MIN } },
        400
      );
    }

    const monthly_price = Math.max(MIN, Math.max(0, area_km2) * RATE);
    const unit_amount   = toPence(monthly_price);

    // Ensure a single, consistent Stripe Customer for this cleaner
    const customerId = await ensureStripeCustomerForCleaner(cleanerId);

    const site = siteBase();

    // Human-friendly product title so it’s obvious in the Billing Portal
    const productTitle = `Area sponsorship #${slot} — area ${areaId.slice(0, 8)}…`;

    // Rich metadata used later by your webhook to write to Supabase
    const commonMeta = {
      cleaner_id: String(cleanerId),
      area_id: String(areaId),
      slot: String(slot),
      area_km2: area_km2.toFixed(6),
      monthly_price_pennies: String(unit_amount),
      months_requested: String(Math.max(1, Number(months))),
      // Handy for correlating sessions if you ever look them up:
      purpose: "area_sponsorship",
    };

    // Create a SUBSCRIPTION session with a recurring (monthly) price
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: `${cleanerId}:${areaId}:${slot}`,

      // Put metadata in multiple places so you can find it reliably in webhooks / exports
      metadata: { ...commonMeta },                      // on the Checkout Session
      subscription_data: { metadata: { ...commonMeta } }, // on the Subscription object created

      line_items: [
        {
          price_data: {
            currency: "gbp",
            unit_amount: unit_amount,
            recurring: { interval: "month", interval_count: 1 },
            product_data: {
              name: productTitle,
              description: `Area: ${area_km2.toFixed(4)} km² • £${monthly_price.toFixed(2)}/month`,
              metadata: { ...commonMeta }, // also on the Product for redundancy
            },
          },
          quantity: 1,
        },
      ],

      // Where to land after Stripe
      success_url: `${site}/#/dashboard?checkout=success&checkout_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/#/dashboard?checkout=cancel`,
      // Let invoices show a short descriptor (must be <=22 chars if you later use statement_descriptor)
      // invoice_creation: { enabled: true }, // optional
      // allow_promotion_codes: true,        // optional
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("[checkout] error:", e);
    return json({ error: e?.message || "checkout failed" }, 500);
  }
};
