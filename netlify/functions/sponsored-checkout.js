// netlify/functions/sponsored-checkout.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

console.log("LOADED sponsored-checkout v2026-01-03 LOCK+CATEGORY+CONSISTENT");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });

// must match dashboard + area-sponsorship
const BLOCKING = new Set(["active", "trialing", "past_due"]);

export default async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const business_id = String(
    body.businessId || body.business_id || body.cleanerId || body.cleaner_id || ""
  ).trim();

  const area_id = String(body.areaId || body.area_id || "").trim();
  const category_id = String(body.categoryId || body.category_id || "").trim();
  const slot = Number(body.slot ?? 1);

  if (!business_id || !area_id || !category_id) {
    return json(
      { ok: false, error: "Missing businessId/areaId/categoryId" },
      400
    );
  }
  if (!Number.isFinite(slot) || slot < 1) {
    return json({ ok: false, error: "Invalid slot" }, 400);
  }

  // Your dashboard expects "Featured slot" = 1
  if (slot !== 1) {
    return json({ ok: false, error: "Only slot 1 is supported" }, 400);
  }

  const success_url =
    body.success_url ||
    `${process.env.APP_URL || "https://findabincleaner.com"}/#/dashboard?checkout=success&checkout_session={CHECKOUT_SESSION_ID}`;

  const cancel_url =
    body.cancel_url ||
    `${process.env.APP_URL || "https://findabincleaner.com"}/#/dashboard?checkout=cancel`;

  try {
    // 1) Block if ACTIVE subscription already exists for this area+slot+category
    const { data: subs, error: subErr } = await supabase
      .from("sponsored_subscriptions")
      .select("id, business_id, status, current_period_end, stripe_subscription_id, updated_at")
      .eq("area_id", area_id)
      .eq("slot", slot)
      .eq("category_id", category_id);

    if (subErr) throw subErr;

    const activeSub = (subs || []).find((r) => BLOCKING.has(String(r.status || "").toLowerCase()));

    if (activeSub) {
      const mine = String(activeSub.business_id) === String(business_id);
      return json(
        {
          ok: false,
          code: mine ? "already_owned" : "already_taken",
          error: mine
            ? "You already sponsor this area."
            : "This area is already sponsored by another business.",
        },
        409
      );
    }

    // 2) Block if another business currently holds an active lock (unexpired)
    const nowIso = new Date().toISOString();

    const { data: locks, error: lockErr } = await supabase
      .from("sponsored_locks")
      .select("id, business_id, expires_at, is_active")
      .eq("area_id", area_id)
      .eq("slot", slot)
      .eq("category_id", category_id)
      .eq("is_active", true)
      .gt("expires_at", nowIso);

    if (lockErr) throw lockErr;

    const activeLock = (locks || [])[0] || null;
    if (activeLock && String(activeLock.business_id) !== String(business_id)) {
      return json(
        {
          ok: false,
          code: "locked",
          error: "This area is currently being purchased by another business. Please try again shortly.",
          lock_expires_at: activeLock.expires_at,
        },
        409
      );
    }

    // 3) Compute purchasable remaining geo/price using your RPC (same as sponsored-preview)
    const { data: previewData, error: previewErr } = await supabase.rpc("area_remaining_preview", {
      p_area_id: area_id,
      p_category_id: category_id,
      p_slot: slot,
    });

    if (previewErr) throw previewErr;

    const previewRow = Array.isArray(previewData) ? previewData[0] : previewData;

    if (!previewRow) {
      return json({ ok: false, error: "Area not found" }, 404);
    }

    const EPS = 1e-6;
    const availableKm2 = Number(previewRow.available_km2 ?? 0) || 0;
    const soldOut =
      Boolean(previewRow.sold_out) || !Number.isFinite(availableKm2) || availableKm2 <= EPS;

    if (soldOut) {
      return json(
        { ok: false, code: "sold_out", error: "No purchasable region is available for this area." },
        409
      );
    }

    const ratePerKm2 =
      Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0) || 0;

    // price in pennies/cents (your postverify stores pennies in price_monthly_pennies)
    const price_pennies = Math.max(100, Math.round(Math.max(availableKm2, 0) * ratePerKm2 * 100));

    // 4) Create (or reuse) a lock for THIS business so UI + checkout stay consistent
    let lock_id = null;

    if (activeLock && String(activeLock.business_id) === String(business_id)) {
      // reuse lock if same biz already started checkout recently
      lock_id = activeLock.id;
    } else {
      const { data: lockInsert, error: lockInsertErr } = await supabase
        .from("sponsored_locks")
        .insert({
          area_id,
          slot,
          business_id,
          category_id,
          is_active: true,
          // expires_at default in table
          final_geojson: previewRow.gj ?? null,
        })
        .select("id, expires_at")
        .single();

      if (lockInsertErr) {
        // If you add a unique partial index on active locks, handle conflict here
        return json(
          { ok: false, code: "locked", error: "This area is currently being purchased. Please try again shortly." },
          409
        );
      }

      lock_id = lockInsert?.id || null;
    }

    // 5) Ensure a Stripe customer exists for this business
    // (If you already store stripe_customer_id elsewhere, update this to fetch it)
    const { data: cleanerRow, error: cleanerErr } = await supabase
      .from("cleaners")
      .select("email, business_name, stripe_customer_id")
      .eq("id", business_id)
      .maybeSingle();

    if (cleanerErr) throw cleanerErr;

    let stripeCustomerId = cleanerRow?.stripe_customer_id || null;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: cleanerRow?.email || undefined,
        name: cleanerRow?.business_name || undefined,
        metadata: { business_id },
      });

      stripeCustomerId = customer.id;

      // store for future
      await supabase.from("cleaners").update({ stripe_customer_id: stripeCustomerId }).eq("id", business_id);
    }

    // 6) Create Stripe Checkout Session
    // IMPORTANT: This assumes you have a Stripe Price ID for the subscription product.
    // If you instead create dynamic prices, replace this section accordingly.
    const priceId = process.env.STRIPE_SPONSOR_PRICE_ID;
    if (!priceId) {
      return json(
        { ok: false, error: "Missing STRIPE_SPONSOR_PRICE_ID env var" },
        500
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      success_url,
      cancel_url,
      line_items: [{ price: priceId, quantity: 1 }],
      // You can optionally use discounts/coupons or subscription_data here
      metadata: {
        business_id,
        area_id,
        category_id,
        slot: String(slot),
        lock_id: lock_id || "",
        // helpful debug:
        available_km2: String(availableKm2),
        price_pennies: String(price_pennies),
      },
    });

    // store stripe session id on lock (helps webhook release / tracing)
    if (lock_id && session?.id) {
      await supabase
        .from("sponsored_locks")
        .update({ stripe_session_id: session.id })
        .eq("id", lock_id);
    }

    return json({
      ok: true,
      url: session.url,
      checkout_session_id: session.id,
      lock_id,
    });
  } catch (e) {
    console.error("[sponsored-checkout] error:", e);
    return json({ ok: false, error: e?.message || "Checkout failed" }, 500);
  }
};
