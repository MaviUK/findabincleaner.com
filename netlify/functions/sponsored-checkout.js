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
const siteBase = () => (process.env.PUBLIC_SITE_URL || "http://localhost:5173").replace(/\/+$/, "");

// ---------------------------------------------------------
// Ownership guards (VERY strict)
// ---------------------------------------------------------
const ACTIVEish = new Set(["active", "trialing", "past_due", "unpaid"]);

const norm = (v) => (v == null ? null : String(v).toLowerCase());

const isEnded = (row) =>
  Boolean(row?.ended_at || row?.cancelled_at || row?.canceled_at || row?.expires_at);

const isCurrentStripeBacked = (row) =>
  ACTIVEish.has(norm(row?.status)) &&
  !isEnded(row) &&
  // require an actual subscription on file to count as "owned"
  !!row?.stripe_subscription_id;

const rowOwnerId = (row) =>
  row?.business_id ?? row?.cleaner_id ?? row?.owner_id ?? null;

async function fetchSubRows(areaId, slot) {
  const { data, error } = await supabase
    .from("sponsored_subscriptions")
    .select(
      "id,area_id,slot,status,business_id,cleaner_id,owner_id,ended_at,cancelled_at,canceled_at,expires_at,stripe_subscription_id"
    )
    .eq("area_id", areaId)
    .eq("slot", Number(slot));
  if (error) {
    console.error("[checkout] fetchSubRows error:", error);
    return [];
  }
  return data || [];
}

async function isOwnedByAnother(areaId, slot, myCleanerId) {
  const rows = await fetchSubRows(areaId, slot);
  for (const r of rows) {
    const owner = rowOwnerId(r);
    if (norm(owner) === norm(myCleanerId)) continue; // it's me, skip
    if (isCurrentStripeBacked(r)) return true;
  }
  return false;
}

async function hasMyCurrent(areaId, slot, myCleanerId) {
  const rows = await fetchSubRows(areaId, slot);
  for (const r of rows) {
    const owner = rowOwnerId(r);
    if (norm(owner) !== norm(myCleanerId)) continue;
    if (isCurrentStripeBacked(r)) return true;
  }
  return false;
}

// ---------------------------------------------------------

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
    const { cleanerId, areaId, slot } = await req.json();
    if (!cleanerId || !areaId || ![1, 2, 3].includes(Number(slot))) {
      return json({ error: "cleanerId, areaId, slot required" }, 400);
    }

    // 0) Block if another business truly owns (Stripe-backed, active-like, not ended)
    if (await isOwnedByAnother(areaId, slot, cleanerId)) {
      return json({ error: `Sponsor #${slot} is already owned by another business for this area.` }, 409);
    }

    // 1) Block duplicate if THIS cleaner already has a current Stripe-backed sub
    if (await hasMyCurrent(areaId, slot, cleanerId)) {
      return json({ error: "You already have an active/prepaid sponsorship for this slot." }, 409);
    }

    // 2) Compute available area for this slot (authoritative server clipping)
    const proc =
      slot === 1
        ? "clip_available_slot1_preview"
        : slot === 2
        ? "clip_available_slot2_preview"
        : "clip_available_slot3_preview";

    const { data, error } = await supabase.rpc(proc, {
      p_cleaner: cleanerId,
      p_area_id: areaId,
    });
    if (error) {
      console.error("[checkout] clipping rpc error:", error);
      return json({ error: "Failed to compute available area" }, 500);
    }

    const row = Array.isArray(data) ? data[0] : data;
    const area_m2 = Number(row?.area_m2 ?? row?.area_sq_m ?? 0);
    const km2 = Math.max(0, area_m2 / 1_000_000);

    if (km2 <= 0) {
      return json({ error: "This slot has no purchasable area left for this region." }, 409);
    }

    // 3) Price
    const rate = RATE[slot] ?? 1;
    const min = MIN[slot] ?? 1;
    const monthly_price = Math.max(min, km2 * rate);
    const unit_amount = toPence(monthly_price);

    // 4) Stripe checkout session
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
            unit_amount,
            recurring: { interval: "month", interval_count: 1 },
            product_data: {
              name: `Area sponsorship #${slot} (${tierName})`,
              description: `Available area: ${km2.toFixed(4)} km² • £${monthly_price.toFixed(2)}/month`,
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
          monthly_price_pennies: String(unit_amount),
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
