// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

console.log("LOADED sponsored-checkout v2025-12-30-GUARD-DUPES");

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

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

// statuses that block purchase
const BLOCKING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

const EPS = 1e-6;

export default async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  // ✅ Accept both old + new naming
  const cleanerId = String(
    body.cleanerId || body.cleaner_id || body.businessId || body.business_id || ""
  ).trim();

  const areaId = String(body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot ?? 1);

  // optional but recommended if you have categories
  const categoryId = String(body.categoryId || body.category_id || "").trim() || null;

  // optional lock id if you are using sponsored_locks
  const lockId = String(body.lockId || body.lock_id || "").trim() || null;

  // OPTIONAL: if later you implement “top-up remaining area” for an existing sponsor,
  // you can call this endpoint with { allowTopUp: true } and adjust the flow.
  const allowTopUp = Boolean(body.allowTopUp);

  if (!cleanerId) return json({ ok: false, error: "Missing cleanerId" }, 400);
  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (![1].includes(slot)) return json({ ok: false, error: "Invalid slot" }, 400);

  try {
    // 1) Is slot taken? (use MOST RECENT blocking row)
    const { data: rows, error: takenErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id, status, stripe_subscription_id, created_at")
      .eq("area_id", areaId)
      .eq("slot", slot)
      .order("created_at", { ascending: false });

    if (takenErr) throw takenErr;

    const blockingRows = (rows || []).filter((r) =>
      BLOCKING.has(String(r.status || "").toLowerCase())
    );

    const latestBlocking = blockingRows[0] || null;
    const ownerBusinessId = latestBlocking?.business_id ? String(latestBlocking.business_id) : null;
    const ownedByMe = ownerBusinessId && ownerBusinessId === String(cleanerId);
    const ownedByOther = ownerBusinessId && ownerBusinessId !== String(cleanerId);

    // ✅ If already sponsored by someone else, block purchase
    if (ownedByOther) {
      return json(
        {
          ok: false,
          code: "slot_taken",
          message: "This area is already sponsored for this slot.",
          owner_business_id: ownerBusinessId,
        },
        409
      );
    }

    // ✅ If already sponsored by YOU, do NOT create another subscription (this causes DB unique errors)
    // If later you want to support “top-ups”, set allowTopUp=true and handle separately.
    if (ownedByMe && !allowTopUp) {
      return json(
        {
          ok: false,
          code: "already_sponsored",
          message:
            "You already sponsor this area. Use Manage Billing to view your subscription, or edit your area if you meant to expand it.",
          stripe_subscription_id: latestBlocking?.stripe_subscription_id || null,
        },
        409
      );
    }

    // 2) Remaining area preview
    const { data: previewRow, error: prevErr } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });

    if (prevErr) throw prevErr;

    const row = Array.isArray(previewRow) ? previewRow[0] || {} : previewRow || {};
    const rawAvailable = row.available_km2 ?? row.area_km2 ?? row.remaining_km2 ?? 0;

    let available_km2 = Number(rawAvailable);
    if (!Number.isFinite(available_km2)) available_km2 = 0;
    available_km2 = Math.max(0, available_km2);

    if (available_km2 <= EPS) {
      return json(
        {
          ok: false,
          code: "no_remaining",
          message: "No purchasable area left for this slot.",
        },
        409
      );
    }

    // 3) Price
    const rate_per_km2 =
      Number(
        process.env.RATE_GOLD_PER_KM2_PER_MONTH ??
          process.env.RATE_PER_KM2_PER_MONTH ??
          0
      ) || 0;

    if (!rate_per_km2 || rate_per_km2 <= 0) {
      return json(
        {
          ok: false,
          code: "missing_rate",
          message:
            "Pricing rate is not configured. Set RATE_GOLD_PER_KM2_PER_MONTH or RATE_PER_KM2_PER_MONTH.",
        },
        500
      );
    }

    const amount_cents = Math.max(1, Math.round(available_km2 * rate_per_km2 * 100));

    // 4) Get or create Stripe customer (CLEANERS schema)
    const { data: cleaner, error: cleanerErr } = await sb
      .from("cleaners")
      .select("id, stripe_customer_id, business_name, contact_email")
      .eq("id", cleanerId)
      .maybeSingle();

    if (cleanerErr) throw cleanerErr;
    if (!cleaner) return json({ ok: false, error: "Cleaner not found" }, 404);

    let stripeCustomerId = cleaner.stripe_customer_id || null;

    if (!stripeCustomerId) {
      const created = await stripe.customers.create({
        name: cleaner.business_name || "Cleaner",
        email: cleaner.contact_email || undefined,
        metadata: { cleaner_id: cleaner.id },
      });

      stripeCustomerId = created.id;

      const { error: upErr } = await sb
        .from("cleaners")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", cleaner.id);

      if (upErr) throw upErr;
    }

    // ✅ metadata used by webhook to resolve context
    const meta = {
      cleaner_id: cleaner.id,
      business_id: cleaner.id, // back-compat
      area_id: areaId,
      slot: String(slot),
      category_id: categoryId || "",
      lock_id: lockId || "",
    };

    // 5) Subscription checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,

      metadata: meta,
      subscription_data: { metadata: meta },

      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: "Featured service area",
              description: "Be shown first in local search for this area.",
            },
            unit_amount: amount_cents,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],

      success_url: `${process.env.PUBLIC_SITE_URL}/#dashboard?checkout=success`,
      cancel_url: `${process.env.PUBLIC_SITE_URL}/#dashboard?checkout=cancel`,
    });

    return json({ ok: true, url: session.url }, 200);
  } catch (e) {
    console.error("[sponsored-checkout] error:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
