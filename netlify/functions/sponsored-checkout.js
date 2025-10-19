// netlify/functions/sponsored-checkout.ts (or .js if you’re using JS)
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, { apiVersion: "2024-06-20" });
const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE as string
);

const RATE = {
  1: Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? 1),
  2: Number(process.env.RATE_SILVER_PER_KM2_PER_MONTH ?? 0.75),
  3: Number(process.env.RATE_BRONZE_PER_KM2_PER_MONTH ?? 0.5),
} as const;

const MIN = {
  1: Number(process.env.MIN_GOLD_PRICE_PER_MONTH ?? 1),
  2: Number(process.env.MIN_SILVER_PRICE_PER_MONTH ?? 0.75),
  3: Number(process.env.MIN_BRONZE_PRICE_PER_MONTH ?? 0.5),
} as const;

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const toPence = (gbp: number) => Math.round(Math.max(0, Number(gbp)) * 100);
const siteBase = () => (process.env.PUBLIC_SITE_URL || "http://localhost:5173").replace(/\/+$/, "");

// Basic duplicate guard (same business/area/slot with active/unsettled status)
async function hasExistingSponsorship(business_id: string, area_id: string, slot: number) {
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
      "active",
      "trialing",
      "past_due",
      "unpaid",
      "incomplete",
      "incomplete_expired",
    ]);
    return activeish.has(row.status) || Boolean(row.stripe_payment_intent_id);
  } catch {
    return false;
  }
}

async function ensureStripeCustomerForCleaner(cleanerId: string) {
  const { data: cleaner, error } = await supabase
    .from("cleaners")
    .select("id,business_name,stripe_customer_id,user_id")
    .eq("id", cleanerId)
    .maybeSingle();
  if (error) throw error;
  if (!cleaner) throw new Error("Cleaner not found");
  if (cleaner.stripe_customer_id) return cleaner.stripe_customer_id as string;

  let email: string | null = null;
  if (cleaner.user_id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", cleaner.user_id)
      .maybeSingle();
    email = (profile?.email as string) || null;
  }

  // Reuse by email if found
  let customerId: string | null = null;
  if (email) {
    const list = await stripe.customers.list({ email, limit: 1 });
    if (list.data.length) customerId = list.data[0].id;
  }
  if (!customerId) {
    const created = await stripe.customers.create({
      email: email || undefined,
      name: (cleaner.business_name as string) || undefined,
      metadata: { cleaner_id: cleanerId },
    });
    customerId = created.id;
  }
  await supabase.from("cleaners").update({ stripe_customer_id: customerId }).eq("id", cleanerId);
  return customerId;
}

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { cleanerId, areaId, slot } = (await req.json()) as {
      cleanerId?: string;
      areaId?: string;
      slot?: number;
    };

    if (!cleanerId || !areaId || !slot || ![1, 2, 3].includes(Number(slot))) {
      return json({ error: "cleanerId, areaId, slot required" }, 400);
    }

    // Duplicate guard for THIS cleaner
    if (await hasExistingSponsorship(cleanerId, areaId, slot)) {
      return json(
        { error: "You already have an active/prepaid sponsorship for this slot." },
        409
      );
    }

    // ---- HARD AVAILABILITY CHECK (server-side) ----
    // Call the general availability function used by the UI preview fallback.
    // This should return the remaining (clipped) region and/or its km² for (areaId, slot).
    const availRes = await fetch(`${siteBase()}/.netlify/functions/area-availability`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ areaId, slot }),
    });

    if (!availRes.ok) {
      const txt = await availRes.text().catch(() => "");
      // If availability cannot be verified, fail safe (block)
      return json(
        { error: `Failed to verify availability (${availRes.status}${txt ? ` – ${txt}` : ""})` },
        502
      );
    }
    const availJson = await availRes.json();
    const km2Avail = Number(
      availJson?.km2_available ?? availJson?.area_km2 ?? availJson?.km2 ?? 0
    );

    if (!Number.isFinite(km2Avail) || km2Avail <= 0) {
      // HARD STOP: nothing left to buy for this slot
      return json(
        { error: `Sponsor #${slot} is already fully taken in this area.` },
        409
      );
    }

    // ---- Price/description using your clipping RPCs (authoritative for price calc) ----
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
    const area_m2 = Number(row?.area_m2 ?? 0);
    const km2 = Math.max(0, area_m2 / 1_000_000);

    // Defensive: if the pricing RPC says zero, block as well.
    if (!Number.isFinite(km2) || km2 <= 0) {
      return json({ error: "This slot has no available area for this region." }, 409);
    }

    const rate = RATE[slot as 1 | 2 | 3] ?? 1;
    const min = MIN[slot as 1 | 2 | 3] ?? 1;
    const monthly_price = Math.max(min, km2 * rate);
    const unit_amount = toPence(monthly_price);

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
              description: `Available area: ${km2.toFixed(4)} km² • £${monthly_price.toFixed(
                2
              )}/month`,
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
  } catch (e: any) {
    console.error("[checkout] error:", e);
    return json({ error: e?.message || "checkout failed" }, 500);
  }
};
