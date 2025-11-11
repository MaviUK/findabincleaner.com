// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const BLOCKING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const areaId = String(body.areaId || "").trim();
  const businessId = String(body.businessId || "").trim();
  const areaName = String(body.areaName || body.area || "").trim();
  const slot = 1; // Featured only

  if (!areaId || !businessId) {
    return json({ ok: false, error: "Missing areaId or businessId" }, 400);
  }

  // Pricing env (fallbacks kept simple)
  const currency = (process.env.CURRENCY || "gbp").toLowerCase();
  const ratePerKm2 = Number(
    process.env.RATE_GOLD_PER_KM2_PER_MONTH ??
      process.env.RATE_PER_KM2_PER_MONTH ??
      0
  );
  const minPerMonth =
    Number(process.env.MIN_GOLD_PRICE_PER_MONTH ?? process.env.MIN_PRICE_PER_MONTH ?? 0) * 100; // convert to pence/cents later

  const siteUrl = process.env.PUBLIC_SITE_URL || "https://findabincleaner.netlify.app";

  try {
    // ------------------------------------------------------------------
    // 1) SOLD-OUT / LOCK CHECK — someone else already owns or is locking
    // ------------------------------------------------------------------
    const { data: ownerRow, error: ownerErr } = await sb
      .from("v_featured_slot_owner")
      .select("owner_business_id")
      .eq("area_id", areaId)
      .eq("slot", slot)
      .maybeSingle();

    if (ownerErr) {
      return json({ ok: false, error: ownerErr.message || "Owner check failed" }, 500);
    }

    const ownedByOther =
      ownerRow &&
      ownerRow.owner_business_id &&
      ownerRow.owner_business_id !== businessId;

    if (ownedByOther) {
      return json(
        {
          ok: false,
          code: "SOLD_OUT",
          error: "This featured slot is already owned by another business.",
        },
        409
      );
    }

    // ------------------------------------------------------------------
    // 2) Compute remaining purchasable area and server-side price
    // ------------------------------------------------------------------
    const { data: prev, error: prevErr } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });
    if (prevErr) {
      return json({ ok: false, error: prevErr.message || "Preview failed" }, 500);
    }

    const row = Array.isArray(prev) ? prev[0] : prev;
    const area_km2 = Math.max(0, Number(row?.area_km2 ?? 0) || 0);

    // total area (for sanity & clamping)
    let total_km2 = null;
    const { data: sa, error: saErr } = await sb
      .from("service_areas")
      .select("gj")
      .eq("id", areaId)
      .maybeSingle();
    if (!saErr && sa?.gj) {
      try {
        // optional: you may precompute and store this in DB to avoid turf here
        // but we keep checkout fast by trusting preview's number and clamp.
        // If you want Turf here, import it; for now we clamp against preview's total if present
        total_km2 = Number(row?.total_km2 ?? null);
      } catch {}
    }

    const available_km2 =
      total_km2 != null ? Math.max(0, Math.min(area_km2, total_km2)) : area_km2;

    if (!Number.isFinite(available_km2) || available_km2 <= 0) {
      return json(
        { ok: false, code: "SOLD_OUT", error: "No purchasable area left for this slot." },
        409
      );
    }

    // Price calculation (monthly)
    const computedCents = Math.round(available_km2 * ratePerKm2 * 100);
    const floorCents = Number.isFinite(minPerMonth) ? minPerMonth : 0;
    const amountCents = Math.max(computedCents, floorCents);

    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return json({ ok: false, error: "Server pricing not configured." }, 500);
    }

    // ------------------------------------------------------------------
    // 3) Create a Stripe Checkout Session (SUBSCRIPTION)
    // ------------------------------------------------------------------
    // Make/find a Stripe customer for the business
    // (If you already store stripe_customer_id, fetch it here)
    let stripeCustomerId = null;

    // Attempt to find an existing customer from previous subs
    const { data: prior, error: priorErr } = await sb
      .from("sponsored_subscriptions")
      .select("stripe_customer_id")
      .eq("business_id", businessId)
      .not("stripe_customer_id", "is", null)
      .limit(1)
      .maybeSingle();

    if (!priorErr && prior?.stripe_customer_id) {
      stripeCustomerId = prior.stripe_customer_id;
    } else {
      // Create a lightweight Customer now; you can enrich after checkout completes
      const cust = await stripe.customers.create({});
      stripeCustomerId = cust.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      success_url: `${siteUrl}/#dashboard?checkout=success&area=${encodeURIComponent(
        areaId
      )}`,
      cancel_url: `${siteUrl}/#dashboard?checkout=cancel`,
      line_items: [
        {
          price_data: {
            currency,
            recurring: { interval: "month" },
            unit_amount: amountCents,
            product_data: {
              name: `Featured Sponsorship — ${areaName || areaId}`,
              description: "First position in local search results for this service area.",
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        app: "findabin",
        business_id: businessId,
        area_id: areaId,
        slot: String(slot),
      },
    });

    // ------------------------------------------------------------------
    // 4) Insert a provisional lock row (status=incomplete)
    //     Use checkout session id as a lock token in stripe_payment_intent_id
    // ------------------------------------------------------------------
    const provisional = {
      business_id: businessId,
      area_id: areaId,
      slot,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: null,
      stripe_payment_intent_id: session.id, // acts as a lock
      stripe_checkout_session_id: session.id,
      price_monthly_pennies: amountCents,
      currency,
      status: "incomplete",
    };

    const { error: insErr } = await sb.from("sponsored_subscriptions").insert(provisional);

    // If a race happened, our unique partial index should block & we tell the user it's sold
    if (insErr) {
      // Re-check owner to return a nice SOLD_OUT message
      const { data: postOwner } = await sb
        .from("v_featured_slot_owner")
        .select("owner_business_id")
        .eq("area_id", areaId)
        .eq("slot", slot)
        .maybeSingle();

      const lockedByOther =
        postOwner &&
        postOwner.owner_business_id &&
        postOwner.owner_business_id !== businessId;

      return json(
        {
          ok: false,
          code: lockedByOther ? "SOLD_OUT" : "LOCK_FAILED",
          error:
            (lockedByOther
              ? "This featured slot has just been claimed by another business."
              : "Could not reserve this slot. Please try again.") +
            (insErr.message ? ` (${insErr.message})` : ""),
        },
        409
      );
    }

    // All good — send user to Stripe
    return json({ ok: true, url: session.url }, 200);
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
