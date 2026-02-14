// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

console.log("LOADED sponsored-checkout v2026-02-14-TTL+RELEASE+SESSIONID");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2024-06-20",
});

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const EPS = 1e-6;
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid"]);

// Lock will auto-expire (prevents “sold out” getting stuck)
const LOCK_TTL_MINUTES = Number(process.env.SPONSORED_LOCK_TTL_MINUTES || 1);

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

function isoPlusMinutes(mins) {
  return new Date(Date.now() + mins * 60 * 1000).toISOString();
}

export default async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true }, 200);
    if (req.method !== "POST")
      return json({ ok: false, error: "Method not allowed" }, 405);

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const cleanerId = String(
      body.cleanerId ||
        body.cleaner_id ||
        body.businessId ||
        body.business_id ||
        ""
    ).trim();

    const areaId = String(body.areaId || body.area_id || "").trim();
    const slot = Number(body.slot ?? 1);
    const categoryId = String(body.categoryId || body.category_id || "").trim();

    const incomingLockId =
      String(body.lockId || body.lock_id || "").trim() || null;
    const allowTopUp = Boolean(body.allowTopUp);

    if (!cleanerId) return json({ ok: false, error: "Missing cleanerId" }, 400);
    if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
    if (!categoryId)
      return json({ ok: false, error: "Missing categoryId" }, 400);
    if (!Number.isFinite(slot) || slot !== 1)
      return json({ ok: false, error: "Invalid slot" }, 400);

    requireEnv("STRIPE_SECRET_KEY");
    requireEnv("PUBLIC_SITE_URL");

    const sb = getSupabaseAdmin();

    // 1) Block if already sponsored by someone else
    const { data: rows, error: takenErr } = await sb
      .from("sponsored_subscriptions")
      .select(
        "business_id, status, stripe_subscription_id, created_at, category_id"
      )
      .eq("area_id", areaId)
      .eq("slot", slot)
      .eq("category_id", categoryId)
      .order("created_at", { ascending: false });

    if (takenErr) throw takenErr;

    const latestBlocking =
      (rows || []).find((r) =>
        BLOCKING.has(String(r.status || "").toLowerCase())
      ) || null;

    const ownerBusinessId = latestBlocking?.business_id
      ? String(latestBlocking.business_id)
      : null;

    const ownedByMe = ownerBusinessId && ownerBusinessId === String(cleanerId);
    const ownedByOther =
      ownerBusinessId && ownerBusinessId !== String(cleanerId);

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

    // 2) Preview (should subtract ONLY non-expired active locks)
    const { data: previewData, error: prevErr } = await sb.rpc(
      "area_remaining_preview_internal",
      {
        p_area_id: areaId,
        p_category_id: categoryId,
        p_slot: slot,
      }
    );

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

    // 2b) Canonical: lock geojson MUST be the purchasable slice returned as `geojson`
    const lockGeo = row?.geojson ?? null;
    if (!lockGeo) {
      return json(
        {
          ok: false,
          error:
            "Preview did not return purchasable geojson. Ensure area_remaining_preview_internal returns `geojson` as the available slice.",
        },
        500
      );
    }

    // 2c) Ensure lock exists (unique by area_id+slot+category_id) + refresh TTL
    let ensuredLockId = incomingLockId;
    const expiresAt = isoPlusMinutes(LOCK_TTL_MINUTES);

    if (ensuredLockId) {
      const { error: upErr } = await sb
        .from("sponsored_locks")
        .update({
          business_id: cleanerId,
          category_id: categoryId,
          is_active: true,
          geojson: lockGeo,
          final_geojson: lockGeo,
          expires_at: expiresAt,
        })
        .eq("id", ensuredLockId);

      if (upErr) throw upErr;
    } else {
      const payload = {
        area_id: areaId,
        slot,
        category_id: categoryId,
        business_id: cleanerId,
        is_active: true,
        geojson: lockGeo,
        final_geojson: lockGeo,
        expires_at: expiresAt,
      };

      const { data: lockRow, error: lockErr } = await sb
        .from("sponsored_locks")
        .upsert(payload, { onConflict: "area_id,slot,category_id" })
        .select("id")
        .single();

      if (lockErr) throw lockErr;
      ensuredLockId = lockRow?.id || null;
    }

    if (!ensuredLockId)
      return json({ ok: false, error: "Failed to create lock" }, 500);

    // 3) Price rate
    const ratePerKm2 =
      Number(
        process.env.RATE_GOLD_PER_KM2_PER_MONTH ??
          process.env.RATE_PER_KM2_PER_MONTH ??
          0
      ) || 0;

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

    const amountCents = Math.max(
      100,
      Math.round(availableKm2 * ratePerKm2 * 100)
    );

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
        metadata: { cleaner_id: cleaner.id },
      });

      stripeCustomerId = created.id;

      const { error: upErr } = await sb
        .from("cleaners")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", cleaner.id);

      if (upErr) throw upErr;
    }

    // 5) Checkout session
    const meta = {
      cleaner_id: String(cleaner.id),
      business_id: String(cleaner.id),
      area_id: String(areaId),
      category_id: String(categoryId),
      slot: String(slot),
      lock_id: String(ensuredLockId),
      available_km2: String(availableKm2),
      rate_per_km2: String(ratePerKm2),
      amount_cents: String(amountCents),
      lock_expires_at: String(expiresAt),
    };

    const publicSite = process.env.PUBLIC_SITE_URL.replace(/\/$/, "");
    const successUrl = `${publicSite}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
    // ✅ include lock_id so frontend can release instantly on cancel
    const cancelUrl = `${publicSite}/dashboard?checkout=cancel&lock_id=${encodeURIComponent(ensuredLockId)}`;
      ensuredLockId
    )}`;

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
              metadata: {
                area_id: String(areaId),
                category_id: String(categoryId),
                slot: String(slot),
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
      metadata: meta,
      subscription_data: { metadata: meta },
    });

    // ✅ Store session id on the lock (optional but very useful)
    // Only works if sponsored_locks has stripe_checkout_session_id column (recommended).
    try {
      await sb
        .from("sponsored_locks")
        .update({
          stripe_checkout_session_id: session.id,
          expires_at: expiresAt, // refresh again
          is_active: true,
        })
        .eq("id", ensuredLockId);
    } catch (e) {
      console.warn(
        "[sponsored-checkout] could not store stripe_checkout_session_id on lock:",
        e?.message || e
      );
    }

    return json({
      ok: true,
      url: session.url,
      checkout_url: session.url,
      lock_id: ensuredLockId,
      amount_cents: amountCents,
      available_km2: availableKm2,
      lock_expires_at: expiresAt,
      stripe_session_id: session.id,
    });
  } catch (e) {
    console.error("[sponsored-checkout] error:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
