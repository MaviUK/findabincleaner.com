import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const EPS = 1e-6;

// lock lasts 15 minutes
const LOCK_MINUTES = 15;

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const businessId = String(body.businessId || body.cleanerId || "").trim();
  const areaId = String(body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot || 1);
  const categoryIdRaw = body.categoryId ?? body.category_id ?? null;
  const categoryId = categoryIdRaw ? String(categoryIdRaw).trim() : null;

  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);
  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (!categoryId) return json({ ok: false, error: "Missing categoryId" }, 400);
  if (![1].includes(slot)) return json({ ok: false, error: "Invalid slot" }, 400);

  try {
    // 0) Clean up expired locks (best-effort)
    await sb
      .from("sponsored_locks")
      .update({ is_active: false })
      .eq("is_active", true)
      .lt("expires_at", new Date().toISOString());

    // 1) Create a lock BEFORE pricing/Stripe session
    // Use expires_at rather than now() in index predicate
    const expiresAt = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();

    // Try to insert lock; if unique conflict, someone else has an active lock
    const { data: lockRow, error: lockErr } = await sb
      .from("sponsored_locks")
      .insert({
        area_id: areaId,
        slot,
        business_id: businessId,
        expires_at: expiresAt,
        is_active: true,
      })
      .select("id")
      .maybeSingle();

    if (lockErr) {
      const msg = String(lockErr.message || "").toLowerCase();
      if (msg.includes("duplicate") || msg.includes("unique")) {
        return json(
          { ok: false, code: "locked", message: "This area is being purchased by someone else. Try again in a minute." },
          409
        );
      }
      throw lockErr;
    }

    const lockId = lockRow?.id;

    // 2) Recompute remaining area (category-specific)
    const { data: previewData, error: prevErr } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_category_id: categoryId,
      p_slot: slot,
    });
    if (prevErr) throw prevErr;

    const row = Array.isArray(previewData) ? previewData[0] || {} : previewData || {};
    let available_km2 = Number(row.available_km2 ?? 0) || 0;
    const sold_out_flag = Boolean(row.sold_out);

    if (sold_out_flag || available_km2 <= EPS) {
      // release lock
      if (lockId) {
        await sb.from("sponsored_locks").update({ is_active: false }).eq("id", lockId);
      }
      return json({ ok: false, code: "no_remaining", message: "No purchasable area left for this category." }, 409);
    }

    // 3) Pricing
    const rate_per_km2 =
      Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0) || 0;

    const amount_cents = Math.max(1, Math.round(available_km2 * rate_per_km2 * 100));

    // 4) Load cleaner and ensure Stripe customer
    const { data: cleaner, error: cleanerErr } = await sb
      .from("cleaners")
      .select("id, stripe_customer_id, business_name, email")
      .eq("id", businessId)
      .maybeSingle();

    if (cleanerErr) throw cleanerErr;
    if (!cleaner) throw new Error("Cleaner not found");

    let stripeCustomerId = cleaner.stripe_customer_id || null;
    const customerName = cleaner.business_name || "Customer";

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        name: customerName,
        email: cleaner.email || undefined,
      });
      stripeCustomerId = customer.id;

      await sb.from("cleaners").update({ stripe_customer_id: stripeCustomerId }).eq("id", businessId);
    }

    // 5) Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      metadata: {
        business_id: businessId,
        area_id: areaId,
        slot: String(slot),
        category_id: categoryId,
        lock_id: lockId || "",
      },
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: "Featured service area",
              description: "Be shown first in local search results for this area.",
            },
            unit_amount: amount_cents,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      success_url: `${PUBLIC_SITE_URL}/#dashboard?checkout=success`,
      cancel_url: `${PUBLIC_SITE_URL}/#dashboard?checkout=cancel`,
    });

    // 6) Save stripe_session_id onto the lock so webhook can release it by session too
    if (lockId) {
      await sb
        .from("sponsored_locks")
        .update({ stripe_session_id: session.id })
        .eq("id", lockId);
    }

    return json({ ok: true, url: session.url }, 200);
  } catch (e) {
    console.error("[sponsored-checkout] error:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
