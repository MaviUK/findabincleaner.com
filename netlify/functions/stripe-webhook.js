// netlify/functions/stripe-webhook.js
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const json = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// treat these as "still blocks the area"
const ACTIVE_LIKE = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);

function normStatus(s) {
  return String(s || "").toLowerCase();
}

/**
 * NEW: lock helpers
 * Your sponsored_locks table columns (from you):
 * id, area_id, slot, business_id, stripe_session_id, created_at
 * + you are adding: expires_at, is_active
 */
async function deactivateLockById(lockId) {
  if (!lockId) return;
  const { error } = await supabase
    .from("sponsored_locks")
    .update({ is_active: false })
    .eq("id", lockId);

  if (error) console.error("[webhook] deactivate lock error:", error);
}

async function deactivateLockBySessionId(stripeSessionId) {
  if (!stripeSessionId) return;
  const { error } = await supabase
    .from("sponsored_locks")
    .update({ is_active: false })
    .eq("stripe_session_id", stripeSessionId);

  if (error) console.error("[webhook] deactivate lock by session error:", error);
}

// best-effort cleanup of expired locks
async function cleanupExpiredLocks() {
  try {
    await supabase
      .from("sponsored_locks")
      .update({ is_active: false })
      .eq("is_active", true)
      .lt("expires_at", new Date().toISOString());
  } catch (e) {
    // do not fail webhook for cleanup
  }
}

async function resolveContext({ meta, customerId }) {
  // checkout sets metadata like: business_id, area_id, slot, category_id, lock_id
  const business_id =
    meta?.business_id || meta?.cleaner_id || meta?.businessId || null;
  const area_id = meta?.area_id || meta?.areaId || null;
  const slot = meta?.slot != null ? Number(meta.slot) : null;
  const category_id = meta?.category_id || meta?.categoryId || null;

  if (business_id && area_id && slot != null) {
    return { business_id, area_id, slot, category_id: category_id || null };
  }

  // Fallback by customerId -> cleaners.stripe_customer_id
  if (customerId) {
    const { data, error } = await supabase
      .from("cleaners")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    if (error) console.error("[webhook] resolveContext fallback error:", error);

    if (data?.id) {
      return {
        business_id: data.id,
        area_id: null,
        slot: null,
        category_id: null,
      };
    }
  }

  return { business_id: null, area_id: null, slot: null, category_id: null };
}

/**
 * Ownership check (best-effort). Real enforcement should be in checkout + DB.
 */
async function slotIsOwnedByOther(payload) {
  if (!payload.area_id || payload.slot == null) return false;

  let q = supabase
    .from("sponsored_subscriptions")
    .select("business_id,status,stripe_subscription_id")
    .eq("area_id", payload.area_id)
    .eq("slot", payload.slot);

  // Keep this line if exclusivity is per category too (you are using category_id in checkout).
  if (payload.category_id) q = q.eq("category_id", payload.category_id);

  const { data, error } = await q;

  if (error) {
    console.error("[webhook] slot ownership check error:", error);
    return false; // fail open
  }

  const blocking = (data || []).filter((r) => ACTIVE_LIKE.has(normStatus(r.status)));

  return blocking.some(
    (r) => String(r.business_id) && String(r.business_id) !== String(payload.business_id)
  );
}

async function cancelStripeSubscriptionSafe(subId, reason) {
  if (!subId) return;
  try {
    console.warn("[webhook] canceling subscription:", subId, reason || "");
    await stripe.subscriptions.cancel(subId);
  } catch (e) {
    console.error("[webhook] failed to cancel subscription:", subId, e);
  }
}

async function upsertSubscription(sub, meta = {}) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;

  const { business_id, area_id, slot, category_id } = await resolveContext({
    meta,
    customerId,
  });

  const firstItem = sub.items?.data?.[0];
  const price = firstItem?.price;

  const payload = {
    business_id,
    area_id,
    category_id,
    slot: slot ?? null,

    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,

    price_monthly_pennies: price?.unit_amount ?? null,
    currency: (price?.currency || sub.currency || "gbp")?.toLowerCase(),

    status: sub.status,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
  };

  // If this subscription is attempting to claim an already-owned slot, cancel it.
  if (payload.area_id && payload.slot != null && payload.business_id) {
    const ownedByOther = await slotIsOwnedByOther(payload);
    if (ownedByOther && ACTIVE_LIKE.has(normStatus(payload.status))) {
      await cancelStripeSubscriptionSafe(sub.id, "Slot already owned by another business");
      payload.status = "canceled";
    }
  }

  const { error } = await supabase
    .from("sponsored_subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  if (error) {
    console.error("[webhook] upsert sponsored_subscriptions error:", error, payload);

    const msg = String(error?.message || "").toLowerCase();
    if (msg.includes("duplicate") || msg.includes("unique")) {
      await cancelStripeSubscriptionSafe(sub.id, "DB uniqueness violation");
      return; // swallow so Stripe doesn't retry forever
    }

    throw new Error("DB upsert(sponsored_subscriptions) failed");
  }
}

async function upsertInvoice(inv) {
  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

  // Find local subscription row
  let { data: subRow, error: findErr } = await supabase
    .from("sponsored_subscriptions")
    .select("id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (findErr) {
    console.error("[webhook] find sub for invoice error:", findErr);
    throw new Error("DB find(sub) for invoice failed");
  }

  // If missing, fetch from Stripe and insert
  if (!subRow && subscriptionId) {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    await upsertSubscription(sub, sub.metadata || {});
    const refetch = await supabase
      .from("sponsored_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    subRow = refetch.data ?? null;
  }

  const payload = {
    sponsored_subscription_id: subRow?.id ?? null,
    stripe_invoice_id: inv.id,
    hosted_invoice_url: inv.hosted_invoice_url ?? null,
    invoice_pdf: inv.invoice_pdf ?? null,
    amount_due_pennies: inv.amount_due ?? null,
    currency: (inv.currency || "gbp")?.toLowerCase(),
    status: inv.status,
    period_start: inv.period_start
      ? new Date(inv.period_start * 1000).toISOString()
      : null,
    period_end: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
  };

  const { error } = await supabase
    .from("sponsored_invoices")
    .upsert(payload, { onConflict: "stripe_invoice_id" });

  if (error) {
    console.error("[webhook] upsert sponsored_invoices error:", error, payload);
    throw new Error("DB upsert(sponsored_invoices) failed");
  }
}

exports.handler = async (event) => {
  // Health check
  if (event.httpMethod === "GET") {
    return json(200, {
      ok: true,
      note: "Stripe webhook is deployed. Use POST from Stripe.",
    });
  }
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const sig =
    event.headers["stripe-signature"] ||
    event.headers["Stripe-Signature"] ||
    null;

  if (!sig) return json(400, { ok: false, error: "Missing stripe-signature header" });

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return json(500, { ok: false, error: "Missing STRIPE_WEBHOOK_SECRET env var" });
  }

  let stripeEvent;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body || "", "utf8");

    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("[webhook] bad signature:", err?.message);
    return json(400, { ok: false, error: "Bad signature" });
  }

  try {
    console.log(`[webhook] ${stripeEvent.type} id=${stripeEvent.id}`);

    // best-effort cleanup (won't break webhook if it fails)
    await cleanupExpiredLocks();

    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        const session = stripeEvent.data.object;

        // ✅ Always release the lock for this checkout session (success)
        // We prefer lock_id, but also support stripe_session_id lookup.
        const lockId = session?.metadata?.lock_id || null;
        if (lockId) {
          await deactivateLockById(lockId);
        } else {
          await deactivateLockBySessionId(session?.id || null);
        }

        if (session.mode === "subscription" && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          await upsertSubscription(sub, session.metadata || {});
        }
        break;
      }

      // If you enable this event in Stripe, it's great for releasing locks on abandoned checkouts.
      case "checkout.session.expired": {
        const session = stripeEvent.data.object;
        const lockId = session?.metadata?.lock_id || null;
        if (lockId) {
          await deactivateLockById(lockId);
        } else {
          await deactivateLockBySessionId(session?.id || null);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = stripeEvent.data.object;
        await upsertSubscription(sub, sub.metadata || {});
        break;
      }

      case "customer.subscription.deleted": {
        const sub = stripeEvent.data.object;

        const { error } = await supabase
          .from("sponsored_subscriptions")
          .update({ status: "canceled" })
          .eq("stripe_subscription_id", sub.id);

        if (error) {
          console.error("[webhook] cancel sub error:", error);
          throw new Error("DB cancel(sub) failed");
        }
        break;
      }

      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.finalized":
      case "invoice.voided": {
        await upsertInvoice(stripeEvent.data.object);
        break;
      }

      default:
        break;
    }

    return json(200, { ok: true });
  } catch (e) {
    console.error("[webhook] handler error:", e);
    return json(500, { ok: false, error: e?.message || "Server error" });
  }
};
