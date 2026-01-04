// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

console.log("LOADED stripe-webhook v2026-01-04-REMAINING-GEOM-TRUTH");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function releaseLock(lockId) {
  if (!lockId) return;
  try {
    await sb.from("sponsored_locks").update({ is_active: false }).eq("id", lockId);
  } catch (e) {
    console.warn("[webhook] failed to release lock:", lockId, e?.message || e);
  }
}

async function upsertSponsoredFromStripe({ sub, meta, unitAmount, currency }) {
  const business_id = meta.business_id || meta.cleaner_id || null;
  const area_id = meta.area_id || null;
  const category_id = meta.category_id || null;
  const slot = Number(meta.slot || 1);
  const lock_id = meta.lock_id || null;

  if (!business_id || !area_id || !category_id || !Number.isFinite(slot)) {
    return { ok: false, error: "missing_required_metadata", lock_id };
  }

  // ✅ compute remaining geometry (MultiPolygon) in DB
  const { data: geomData, error: geomErr } = await sb.rpc("compute_remaining_sponsored_geom", {
    p_area_id: area_id,
    p_category_id: category_id,
    p_slot: slot,
    p_ignore_subscription_id: null,
  });

  if (geomErr) throw geomErr;

  // If null => nothing left (fully overlapped)
  if (!geomData) {
    console.warn("[webhook] overlap prevented DB write; lock will be released.", {
      business_id,
      area_id,
      category_id,
      slot,
      stripe_subscription_id: sub.id,
    });
    await releaseLock(lock_id);
    return { ok: false, overlap: true, lock_id };
  }

  // We pass EWKT via PostgREST by using ST_GeomFromEWKT in a DB function normally,
  // BUT Supabase can accept geometry if PostgREST is configured for PostGIS types.
  // Safest approach: store as EWKT text in an RPC or keep geometry directly if supported.
  // Here we assume geometry type is accepted by PostgREST (common in Supabase PostGIS).
  const sponsored_geom = geomData;

  const currentPeriodEndIso =
    sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;

  const payload = {
    business_id,
    area_id,
    category_id,
    slot,
    stripe_customer_id: String(sub.customer || ""),
    stripe_subscription_id: sub.id,
    price_monthly_pennies: unitAmount ?? null,
    currency: (currency || "gbp").toLowerCase(),
    status: String(sub.status || "active"),
    current_period_end: currentPeriodEndIso,
    sponsored_geom,
  };

  const { error: upErr } = await sb
    .from("sponsored_subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  if (upErr) throw upErr;

  await releaseLock(lock_id);
  return { ok: true, lock_id };
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok: true, note: "POST only" }, 200);

  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[webhook] signature verification failed:", err?.message || err);
    return json({ ok: false, error: "Bad signature" }, 400);
  }

  try {
    const type = event.type;
    const obj = event.data.object;

    // We only need subscription + metadata + price, and we must avoid writing if overlap
    if (type === "checkout.session.completed") {
      const session = obj;

      const expanded = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ["subscription", "line_items.data.price"],
      });

      const sub = typeof expanded.subscription === "string" ? null : expanded.subscription;
      if (!sub) return json({ ok: true, note: "no subscription" }, 200);

      const unitAmount = expanded.line_items?.data?.[0]?.price?.unit_amount ?? null;
      const currency = expanded.currency || "gbp";
      const meta = expanded.metadata || {};

      await upsertSponsoredFromStripe({ sub, meta, unitAmount, currency });
      return json({ ok: true }, 200);
    }

    if (type === "customer.subscription.created" || type === "customer.subscription.updated") {
      const sub = obj;
      const meta = sub.metadata || {};
      // price may not be present here reliably; keep null (you can update later on invoice.paid)
      await upsertSponsoredFromStripe({
        sub,
        meta,
        unitAmount: null,
        currency: "gbp",
      });
      return json({ ok: true }, 200);
    }

    if (type === "customer.subscription.deleted") {
      const sub = obj;
      const { error } = await sb
        .from("sponsored_subscriptions")
        .update({ status: "canceled" })
        .eq("stripe_subscription_id", sub.id);

      if (error) throw error;
      return json({ ok: true }, 200);
    }

    // ignore others
    return json({ ok: true, ignored: type }, 200);
  } catch (e) {
    console.error("[stripe-webhook] handler error:", e);
    return json({ ok: false, error: e?.message || "handler failed" }, 500);
  }
};
