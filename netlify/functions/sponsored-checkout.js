// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

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
  "paused",
]);

const EPS = 1e-6;

export default async (req) => {
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

  if (!cleanerId) return json({ ok: false, error: "Missing cleanerId" }, 400);
  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (![1].includes(slot)) return json({ ok: false, error: "Invalid slot" }, 400);

  try {
    // 1) Is slot taken by someone else?
    const { data: takenRows, error: takenErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id, status")
      .eq("area_id", areaId)
      .eq("slot", slot);

    if (takenErr) throw takenErr;

    const blocking = (takenRows || []).filter((r) =>
      BLOCKING.has(String(r.status || "").toLowerCase())
    );

    const ownedByOther =
      (blocking?.length || 0) > 0 &&
      String(blocking[0].business_id) !== String(cleanerId);

    if (ownedByOther) {
      return json(
        {
          ok: false,
          code: "slot_taken",
          message: "No purchasable area left for this slot.",
        },
        409
      );
    }

    // 2) Remaining area preview
    const { data: previewRow, error: prevErr } = await sb.rpc(
      "area_remaining_preview",
      {
        p_area_id: areaId,
        p_slot: slot,
      }
    );
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

    // ✅ MUST be defined (you were using `meta` but never created it)
    const meta = {
      cleaner_id: cleaner.id,
      business_id: cleaner.id, // back-compat for older webhook logic
      area_id: areaId,
      slot: String(slot),
      category_id: categoryId || "",
      lock_id: lockId || "",
    };

    // 5) Subscription checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,

      // ✅ Session metadata (used by checkout.session.completed)
      metadata: meta,

      // ✅ Subscription metadata (used by customer.subscription.* events)
      subscription_data: {
        metadata: meta,
      },

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
