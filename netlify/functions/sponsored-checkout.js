// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

console.log("LOADED sponsored-checkout v2026-01-13-UPSERT-LOCK+DYNAMIC-PRICE");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2024-06-20",
});

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  // include authorization so you can add auth later without CORS pain
  "access-control-allow-headers": "content-type,authorization",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const EPS = 1e-6;

// ✅ Only REAL blocking statuses (do NOT include incomplete / paused)
const BLOCKING = new Set(["active", "trialing", "past_due"]); // optionally add "unpaid"

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE in Netlify env."
    );
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

function firstNonNull(...vals) {
  for (const v of vals) if (v != null) return v;
  return null;
}

// Safe stringify for metadata
function safeString(v) {
  try {
    if (v == null) return "";
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  } catch {
    return String(v ?? "");
  }
}

export default async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true }, 200);
    if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    // Accept old/new naming
    const cleanerId = String(
      body.cleanerId || body.cleaner_id || body.businessId || body.business_id || ""
    ).trim();

    const areaId = String(body.areaId || body.area_id || "").trim();
    const slot = Number(body.slot ?? 1);

    // category required for availability/pricing logic
    const categoryId = String(body.categoryId || body.category_id || "").trim();

    // caller may pass lockId, but we will ensure one exists / belongs to area+slot
    const incomingLockId = String(body.lockId || body.lock_id || "").trim() || null;

    const allowTopUp = Boolean(body.allowTopUp);

    if (!cleanerId) return json({ ok: false, error: "Missing cleanerId" }, 400);
    if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
    if (!categoryId) return json({ ok: false, error: "Missing categoryId" }, 400);
    if (!Number.isFinite(slot) || slot < 1) return json({ ok: false, error: "Invalid slot" }, 400);
    if (slot !== 1) return json({ ok: false, error: "Invalid slot" }, 400);

    // Ensure required env exists (so you DON'T get mystery 502s)
    requireEnv("STRIPE_SECRET_KEY");
    requireEnv("PUBLIC_SITE_URL");

    const sb = getSupabaseAdmin();

    // 1) If this exact area_id is already sponsored by someone else for this slot, block
    const { data: rows, error: takenErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id, status, stripe_subscription_id, created_at")
      .eq("area_id", areaId)
      .eq("slot", slot)
      .order("created_at", { ascending: false });

    if (takenErr) throw takenErr;

    const latestBlocking =
      (rows || []).find((r) => BLOCKING.has(String(r.status || "").toLowerCase())) || null;

    const ownerBusinessId = latestBlocking?.business_id ? String(latestBlocking.business_id) : null;

    const ownedByMe = ownerBusinessId && ownerBusinessId === String(cleanerId);
    const ownedByOther = ownerBusinessId && ownerBusinessId !== String(cleanerId);

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

    // 2) Remaining area preview (category-aware)
    const { data: previewData, error: prevErr } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_category_id: categoryId,
      p_slot: slot,
    });

    if (prevErr) throw prevErr;

    const row = Array.isArray(previewData) ? previewData[0] : previewData;
    if (!row) return json({ ok: false, error: "Area not found" }, 404);

    const availableKm2 = Math.max(0, Number(row.available_km2 ?? 0) || 0);
    const soldOut = Boolean(row.sold_out) || availableKm2 <= EPS;

    if (soldOut) {
      return json(
        {
          ok: false,
          code: "no_remaining",
          available_km2: 0,
          reason: row.reason || "no_remaining",
        },
        409
      );
    }

    // ✅ geometry to store in lock (the purchasable remaining portion)
    const lockGeo = firstNonNull(
      row?.sponsored_geojson,
      row?.final_geojson,
      row?.gj,
      row?.geojson,
      row?.geometry,
      row?.geom
    );

    if (!lockGeo) {
      return json(
        {
          ok: false,
          error:
            "Preview did not return geometry (expected row.gj/geojson/sponsored_geojson).",
        },
        500
      );
    }

    // 2b) Ensure / reuse lock
    let ensuredLockId = incomingLockId;

    // If a lockId is passed, verify it exists and matches area+slot (avoid using random ids)
    if (ensuredLockId) {
      const { data: existing, error: exErr } = await sb
        .from("sponsored_locks")
        .select("id, area_id, slot")
        .eq("id", ensuredLockId)
        .maybeSingle();

      if (exErr) throw exErr;

      if (!existing || String(existing.area_id) !== String(areaId) || Number(existing.slot) !== slot) {
        ensuredLockId = null; // ignore bad lock id
      }
    }

    // If no verified lock id, upsert by (area_id,slot) to avoid duplicate key errors
    if (!ensuredLockId) {
      const { data: lockRow, error: lockErr } = await sb
        .from("sponsored_locks")
        .upsert(
          {
            area_id: areaId,
            slot,
            business_id: cleanerId,
            category_id: categoryId,
            is_active: true,
            geojson: lockGeo,
          },
          { onConflict: "area_id,slot" }
        )
        .select("id")
        .single();

      if (lockErr) throw lockErr;
      ensuredLockId = lockRow?.id || null;
    } else {
      // lock exists; refresh geojson + ownership so UI always paints the correct piece
      const { error: updErr } = await sb
        .from("sponsored_locks")
        .update({
          business_id: cleanerId,
          category_id: categoryId,
          is_active: true,
          geojson: lockGeo,
        })
        .eq("id", ensuredLockId);

      if (updErr) throw updErr;
    }

    if (!ensuredLockId) return json({ ok: false, error: "Failed to create lock" }, 500);

    // 3) Price
    const ratePerKm2 =
      Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0) ||
      0;

    if (!ratePerKm2 || ratePerKm2 <= 0) {
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

    // Floor = £1.00 minimum (100 cents)
    const amountCents = Math.max(100, Math.round(availableKm2 * ratePerKm2 * 100));

    // 4) Load cleaner + ensure Stripe customer
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
        metadata: { cleaner_id: String(cleaner.id) },
      });

      stripeCustomerId = created.id;

      const { error: upErr } = await sb
        .from("cleaners")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", cleaner.id);

      if (upErr) throw upErr;
    }

    // ✅ metadata used by webhook/postverify (includes lock_id)
    const meta = {
      cleaner_id: safeString(cleaner.id),
      business_id: safeString(cleaner.id),
      area_id: safeString(areaId),
      category_id: safeString(categoryId),
      slot: safeString(slot),
      lock_id: safeString(ensuredLockId),
      available_km2: safeString(availableKm2),
      rate_per_km2: safeString(ratePerKm2),
      amount_cents: safeString(amountCents),
    };

    const publicSite = String(process.env.PUBLIC_SITE_URL || "").replace(/\/$/, "");
    const successUrl = `${publicSite}/#/dashboard?checkout=success`;
    const cancelUrl = `${publicSite}/#/dashboard?checkout=cancel`;

    // 5) Checkout session (subscription) — dynamic recurring price_data (no product/price id needed)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,

      line_items: [
        {
          price_data: {
            currency: "gbp",
            recurring: { interval: "month" },
            product_data: {
              name: "Featured Sponsorship",
              description: `Area sponsorship (slot ${slot})`,
              // Optional: helps you identify it in Stripe UI
              metadata: {
                area_id: safeString(areaId),
                category_id: safeString(categoryId),
                slot: safeString(slot),
              },
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],

      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: cancelUrl,

      // Store info on both Checkout + Subscription (handy for webhook)
      metadata: meta,
      subscription_data: { metadata: meta },
    });

    return json({
      ok: true,
      checkout_url: session.url,
      lock_id: ensuredLockId,
      amount_cents: amountCents,
      available_km2: availableKm2,
    });
  } catch (e) {
    console.error("[sponsored-checkout] error:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
