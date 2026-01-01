// netlify/functions/stripe-webhook.js
console.log("LOADED stripe-webhook v2026-01-01-PAYMENT-FAILED-NOTIFY");

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const { createInvoiceAndEmailByStripeInvoiceId } = require("./_lib/createInvoiceCore");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function resolveContext({ meta, customerId }) {
  const business_id = meta?.business_id || meta?.cleaner_id || meta?.businessId || null;
  const area_id = meta?.area_id || meta?.areaId || null;
  const slot = meta?.slot != null ? Number(meta.slot) : null;
  const category_id = meta?.category_id || meta?.categoryId || null;
  const lock_id = meta?.lock_id || null;

  if (business_id && area_id && slot != null) {
    return { business_id, area_id, slot, category_id: category_id || null, lock_id };
  }

  if (customerId) {
    const { data } = await supabase
      .from("cleaners")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    if (data?.id) {
      return { business_id: data.id, area_id: null, slot: null, category_id: null, lock_id };
    }
  }

  return { business_id: null, area_id: null, slot: null, category_id: null, lock_id };
}

async function releaseLockSafe(lockId) {
  if (!lockId) return;
  try {
    await supabase.from("sponsored_locks").update({ is_active: false }).eq("id", lockId);
  } catch (e) {
    console.error("[webhook] failed to release lock:", lockId, e?.message || e);
  }
}

async function cancelStripeSubscriptionSafe(subId, reason) {
  if (!subId) return;
  try {
    console.warn("[webhook] canceling subscription:", subId, reason || "");
    await stripe.subscriptions.cancel(subId);
  } catch (e) {
    console.error("[webhook] failed to cancel subscription:", subId, e?.message || e);
  }
}

/**
 * ✅ Works even if there is NO usable unique constraint for ON CONFLICT.
 * Strategy:
 * 1) Try UPDATE the row for (business_id, area_id, slot)
 * 2) If nothing updated, INSERT a new row
 * 3) If INSERT fails due to uniqueness, treat as owned-by-other and cancel
 */
async function upsertSubscription(sub, meta = {}) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;

  const { business_id, area_id, slot, category_id, lock_id } = await resolveContext({
    meta,
    customerId,
  });

  if (!business_id || !area_id || slot == null) {
    console.warn("[webhook] skipping sponsored_subscriptions upsert (missing business/area/slot)", {
      sub_id: sub.id,
      customerId,
      business_id,
      area_id,
      slot,
      category_id,
      meta,
    });
    await releaseLockSafe(lock_id);
    return;
  }

  const firstItem = sub.items?.data?.[0];
  const price = firstItem?.price;

  const payload = {
    business_id,
    area_id,
    category_id: category_id || null,
    slot,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    price_monthly_pennies: price?.unit_amount ?? null,
    currency: (price?.currency || sub.currency || "gbp")?.toLowerCase(),
    status: sub.status,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
  };

  // 1) UPDATE first
  const { data: updatedRows, error: updErr } = await supabase
    .from("sponsored_subscriptions")
    .update({
      stripe_customer_id: payload.stripe_customer_id,
      stripe_subscription_id: payload.stripe_subscription_id,
      price_monthly_pennies: payload.price_monthly_pennies,
      currency: payload.currency,
      status: payload.status,
      current_period_end: payload.current_period_end,
      category_id: payload.category_id,
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", business_id)
    .eq("area_id", area_id)
    .eq("slot", slot)
    .select("id");

  if (updErr) {
    console.error("[webhook] update sponsored_subscriptions error:", updErr, payload);
    // continue to insert attempt
  } else if ((updatedRows || []).length > 0) {
    console.log("[webhook] updated existing sponsored_subscriptions row", {
      business_id,
      area_id,
      slot,
      sub_id: sub.id,
      status: sub.status,
    });
    await releaseLockSafe(lock_id);
    return;
  }

  // 2) INSERT if no row was updated
  const { error: insErr } = await supabase.from("sponsored_subscriptions").insert({
    ...payload,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (!insErr) {
    console.log("[webhook] inserted sponsored_subscriptions row", {
      business_id,
      area_id,
      slot,
      sub_id: sub.id,
      status: sub.status,
    });
    await releaseLockSafe(lock_id);
    return;
  }

  console.error("[webhook] insert sponsored_subscriptions error:", insErr, payload);

  // 3) If insert fails due to uniqueness/overlap, cancel subscription
  const msg = String(insErr?.message || "").toLowerCase();
  const code = String(insErr?.code || "").toLowerCase();

  if (code === "23505" || msg.includes("duplicate") || msg.includes("unique") || msg.includes("overlaps")) {
    await cancelStripeSubscriptionSafe(sub.id, "Overlap/uniqueness violation");
    await releaseLockSafe(lock_id);
    return;
  }

  await releaseLockSafe(lock_id);
  throw new Error("DB write(sponsored_subscriptions) failed");
}

async function upsertInvoice(inv) {
  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id ?? null;

  let subRow = null;

  // 1) First try: match by stripe_subscription_id
  if (subscriptionId) {
    const { data, error } = await supabase
      .from("sponsored_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    if (error) {
      console.error("[webhook] find sub by stripe_subscription_id error:", error);
    } else {
      subRow = data ?? null;
    }
  }

  // 2) If not found, retrieve subscription from Stripe, upsert it, then try again
  let stripeSub = null;
  if (!subRow && subscriptionId) {
    stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
    await upsertSubscription(stripeSub, stripeSub.metadata || {});

    const { data, error } = await supabase
      .from("sponsored_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    if (error) {
      console.error("[webhook] refetch sub by stripe_subscription_id error:", error);
    } else {
      subRow = data ?? null;
    }
  }

  // 3) ✅ FALLBACK: use metadata identity (business_id + area_id + slot)
  if (!subRow && subscriptionId) {
    if (!stripeSub) stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
    const meta = stripeSub.metadata || {};

    const business_id = meta.business_id || meta.cleaner_id || meta.businessId || null;
    const area_id = meta.area_id || meta.areaId || null;
    const slot = meta.slot != null ? Number(meta.slot) : null;

    if (business_id && area_id && slot != null) {
      const { data, error } = await supabase
        .from("sponsored_subscriptions")
        .select("id")
        .eq("business_id", business_id)
        .eq("area_id", area_id)
        .eq("slot", slot)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("[webhook] fallback find sub by business/area/slot error:", error);
      } else {
        subRow = data ?? null;
      }
    } else {
      console.warn("[webhook] invoice fallback skipped: missing meta keys", {
        subscriptionId,
        business_id,
        area_id,
        slot,
        meta,
      });
    }
  }

  const payload = {
    sponsored_subscription_id: subRow?.id ?? null,
    stripe_invoice_id: inv.id,
    hosted_invoice_url: inv.hosted_invoice_url ?? null,
    invoice_pdf: inv.invoice_pdf ?? null,
    amount_due_pennies: inv.amount_due ?? null,
    currency: (inv.currency || "gbp")?.toLowerCase(),
    status: inv.status,
    period_start: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
    period_end: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("sponsored_invoices")
    .upsert(payload, { onConflict: "stripe_invoice_id" });

  if (error) {
    console.error("[webhook] upsert sponsored_invoices error:", error, payload);
    throw new Error("DB upsert(sponsored_invoices) failed");
  }

  return { sponsored_subscription_id: payload.sponsored_subscription_id || null };
}

/**
 * When invoice events happen, refresh subscription status.
 */
async function refreshSubscriptionFromInvoice(inv) {
  try {
    const subId =
      typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id ?? null;
    if (!subId) return;

    const sub = await stripe.subscriptions.retrieve(subId);
    await upsertSubscription(sub, sub.metadata || {});
  } catch (e) {
    console.error("[webhook] refreshSubscriptionFromInvoice failed:", e?.message || e);
  }
}

async function safeCreateAndEmailInvoice(stripeInvoiceId, opts = {}) {
  try {
    const result = await createInvoiceAndEmailByStripeInvoiceId(stripeInvoiceId, opts);
    console.log("[webhook] createInvoiceAndEmail result:", stripeInvoiceId, result);
    return result;
  } catch (err) {
    console.error(
      "[webhook] createInvoiceAndEmail ERROR:",
      stripeInvoiceId,
      err?.message || err,
      err?.stack || ""
    );
    return "error";
  }
}

/**
 * Send "Payment failed" notification to the business.
 * Uses Resend if RESEND_API_KEY is set.
 */
async function notifyPaymentFailed(inv, sponsored_subscription_id) {
  try {
    // Resolve business email
    let business = null;

    if (sponsored_subscription_id) {
      // join: sponsored_subscriptions -> cleaners
      const { data, error } = await supabase
        .from("sponsored_subscriptions")
        .select("business_id, area_id, slot, category_id, cleaners:business_id ( id, business_name, contact_email )")
        .eq("id", sponsored_subscription_id)
        .maybeSingle();

      if (error) {
        console.error("[webhook] notifyPaymentFailed join error:", error);
      } else {
        business = data || null;
      }
    }

    // Fallback: try customer email from Stripe invoice if no cleaner row
    const toEmail =
      business?.cleaners?.contact_email ||
      inv.customer_email ||
      null;

    if (!toEmail) {
      console.warn("[webhook] notifyPaymentFailed: no email found", {
        invoice_id: inv.id,
        sponsored_subscription_id,
      });
      return;
    }

    const fromEmail = process.env.BILLING_FROM_EMAIL || "billing@clean.ly";
    const payUrl = inv.hosted_invoice_url || null;
    const amount = typeof inv.amount_due === "number" ? (inv.amount_due / 100).toFixed(2) : null;
    const currency = (inv.currency || "gbp").toUpperCase();

    const bizName = business?.cleaners?.business_name || "your account";

    const subject = `Payment failed – action required (${currency}${amount ?? ""})`;

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5">
        <h2 style="margin:0 0 12px">Payment failed – action required</h2>
        <p>Hi ${bizName},</p>
        <p>We tried to take payment for your sponsored listing, but the payment didn’t go through.</p>
        <p><strong>Invoice:</strong> ${inv.id}<br/>
           <strong>Amount due:</strong> ${amount ? `${currency} ${amount}` : currency}</p>
        ${
          payUrl
            ? `<p><a href="${payUrl}" style="display:inline-block;padding:10px 14px;background:#111;color:#fff;text-decoration:none;border-radius:8px">
                 Fix payment / Pay now
               </a></p>`
            : `<p>Please log in to update your payment method.</p>`
        }
        <p style="color:#666;font-size:13px">
          Your sponsorship stays in place during Stripe’s retry window (if retries are enabled). If payment continues to fail, Stripe may pause or cancel the subscription.
        </p>
      </div>
    `;

    // If no Resend key, log only
    if (!process.env.RESEND_API_KEY) {
      console.warn("[webhook] RESEND_API_KEY not set. Would have emailed:", {
        to: toEmail,
        subject,
        payUrl,
      });
      return;
    }

    const { Resend } = require("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      subject,
      html,
    });

    console.log("[webhook] notifyPaymentFailed sent", { toEmail, invoice_id: inv.id });
  } catch (e) {
    console.error("[webhook] notifyPaymentFailed failed:", e?.message || e);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json(200, { ok: true, note: "Stripe webhook is deployed. Use POST from Stripe." });
  }
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"] || null;
  if (!sig) return json(400, { ok: false, error: "Missing stripe-signature header" });

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return json(500, { ok: false, error: "Missing STRIPE_WEBHOOK_SECRET env var" });
  }

  let stripeEvent;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body || "", "utf8");

    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[webhook] bad signature:", err?.message);
    return json(400, { ok: false, error: "Bad signature" });
  }

  try {
    console.log(`[webhook] ${stripeEvent.type} id=${stripeEvent.id}`);

    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        const session = stripeEvent.data.object;
        if (session.mode === "subscription" && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          await upsertSubscription(sub, session.metadata || {});
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
          .update({ status: "canceled", updated_at: new Date().toISOString() })
          .eq("stripe_subscription_id", sub.id);

        if (error) throw new Error("DB cancel(sub) failed");
        break;
      }

      case "invoice.finalized":
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.voided":
      case "invoice.sent": {
        const inv = stripeEvent.data.object;

        // Record invoice row
        const { sponsored_subscription_id } = await upsertInvoice(inv);

        // Refresh subscription status from Stripe after invoice events
        await refreshSubscriptionFromInvoice(inv);

        // ✅ CHANGE: Only email your invoice/receipt on PAID
        if (stripeEvent.type === "invoice.paid") {
          console.log("[webhook] invoice.paid -> createInvoiceAndEmail", inv.id);
          await safeCreateAndEmailInvoice(inv.id, { force: false });
        }

        // ✅ NEW: Payment failed notification (action required)
        if (stripeEvent.type === "invoice.payment_failed") {
          console.log("[webhook] invoice.payment_failed -> notifyPaymentFailed", inv.id);
          await notifyPaymentFailed(inv, sponsored_subscription_id);
        }

        // ❌ REMOVED: finalized/sent invoice emailing (prevents confusion)
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
