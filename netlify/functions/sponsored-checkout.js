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

// Treat these as "owned or reserved"
const ACTIVEISH = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
  "requires_payment_method",
  "requires_action",
]);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const toPence = (gbp) => Math.round(Math.max(0, Number(gbp)) * 100);
const siteBase = () =>
  (process.env.PUBLIC_SITE_URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.URL ||
    "http://localhost:8888").replace(/\/+$/, "");

// Normalize owner from a row that may use business_id or cleaner_id
const ownerIdFromRow = (row) => row?.business_id ?? row?.cleaner_id ?? null;

/** SAME business duplicate guard */
async function hasExistingForSameBusiness(myId, areaId, slot) {
  const { data, error } = await supabase
    .from("sponsored_subscriptions")
    .select("status,stripe_payment_intent_id,business_id,cleaner_id")
    .eq("area_id", areaId)
    .eq("slot", Number(slot))
    .or(`business_id.eq.${myId},cleaner_id.eq.${myId}`);

  if (error) {
    console.error("[checkout] same-biz guard error:", error);
    return false;
  }
  for (const row of data || []) {
    const owned = ACTIVEISH.has(row.status) || Boolean(row.stripe_payment_intent_id);
    if (owned) return true;
  }
  return false;
}

/** HARD BLOCK: any other owner on (area, slot) */
async function isOwnedByAnother(areaId, slot, myId) {
  const { data, error } = await supabase
    .from("sponsored_subscriptions")
    .select("business_id,cleaner_id,status,stripe_payment_intent_id")
    .eq("area_id", areaId)
    .eq("slot", Number(slot));

  if (error) {
    console.error("[checkout] other-owner query error:", error);
    return true; // conservative
  }
  for (const row of data || []) {
    const owner = ownerIdFromRow(row);
    const owned = ACTIVEISH.has(row.status) || Boolean(row.stripe_payment_intent_id);
    const isOther = owner && String(owner) !== String(myId);
    if (owned && isOther) return true;
  }
  return false;
}

// Use preview for authoritative remaining-km²/price for *this slot*
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
  const j = await res.json();
  if (!j?.ok) throw new Error(j?.error || "Preview failed");
  const km2 = Number(j.area_km2);
  const monthly = Number(j.monthly_price);
  return {
    km2: Number.isFinite(km2) ? km2 : 0,
    monthly: Number.isFinite(monthly) ? monthly : null,
  };
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
      metadata: { cleaner_id: cleanerId },
    });
    customerId = created.id;
  }
  await supabase.from("cleaners").update({ stripe_customer_id: customerId }).eq("id", cleanerId);
  return customerId;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const cleanerId = String(body?.cleanerId ?? "");
    const areaId = String(body?.areaId ?? "");
    const slot = Number(body?.slot);

    if (!cleanerId || !areaId || ![1, 2, 3].includes(slot)) {
      return json({ error: "cleanerId, areaId, slot required" }, 400);
    }

    // 1) same-business duplicate guard
    if (await hasExistingForSameBusiness(cleanerId, areaId, slot)) {
      return json({ error: "You already have an active/prepaid sponsorship for this slot." }, 409);
    }

    // 2) hard block if any other owner exists
    if (await isOwnedByAnother(areaId, slot, cleanerId)) {
      return json({ error: `Sponsor #${slot} is already owned by another business for this area.` }, 409);
    }

    // 3) compute remaining km² and price (authoritative)
    const { km2, monthly } = await serverPreview(cleanerId, areaId, slot);
    if (!Number.isFinite(km2) || km2 <= 0) {
      return json({ error: `Sponsor #${slot} has no purchasable area left in this region.` }, 409);
    }

    const monthlyPrice = monthly ?? Math.max(MIN[slot] ?? 1, km2 * (RATE[slot] ?? 1));
    const unitAmount = toPence(monthlyPrice);

    // 4) Stripe checkout
    const customerId = await ensureStripeCustomerForCleaner(cleanerId);
    const site = siteBase();
    const tierName = slot === 1 ? "Gold" : slot === 2 ? "Silver" : "Bronze";

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
              description: `Available area: ${km2.toFixed(4)} km² • £${(unitAmount / 100).toFixed(2)}/month`,
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
          available_area_km2: km2.toFixed(6),
          monthly_price_pennies: String(unitAmount),
          tier: tierName,
        },
      },
      metadata: { cleaner_id: cleanerId, area_id: areaId, slot: String(slot) },
      success_url: `${site}/#/dashboard?checkout=success&checkout_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/#/dashboard?checkout=cancel`,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("[checkout] error:", e);
    return json({ error: e?.message || "checkout failed" }, 500);
  }
};
