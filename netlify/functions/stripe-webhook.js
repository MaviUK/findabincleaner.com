// netlify/functions/stripe-webhook.js
console.log("LOADED stripe-webhook v2026-01-01-PAYFAIL-NOTIFY-SUBID-FIRST");

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

/** -------- Email helpers (Resend REST API) -------- */
async function sendResendEmail({ to, subject, html }) {
  const { RESEND_API_KEY, BILLING_FROM } = process.env;
  if (!RESEND_API_KEY || !BILLING_FROM) {
    console.warn("[webhook] Resend not configured (RESEND_API_KEY/BILLING_FROM missing)");
    return false;
  }
  if (!to) return false;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: BILLING_FROM,
      to,
      subject,
      html,
    }),
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    console.error("[webhook] Resend error:", txt || r.statusText);
    return false;
  }
  return true;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function getCleanerByStripeCustomerId(customerId) {
  if (!customerId) return null;
  const { data, error } = await supabase
    .from("cleaners")
    .select("id, business_name, contact_email, stripe_customer_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) {
    console.error("[webhook] getCleanerByStripeCustomerId error:", error);
    return null;
  }
  return data || null;
}

async function notifyPaymentFailed(inv) {
  try {
    const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null;
    const cleaner = await getCleanerByStripeCustomerId(customerId);

    const toCustomer = cleaner?.contact_email || inv.customer_email || null;
    const adminTo = process.env.BILLING_ADMIN_TO || null;

    const amount = (Number(inv.amount_due ?? inv.amount_remaining ?? 0) / 100).toFixed(2);
    const currency = (inv.currency || "gbp").toUpperCase();
    const hostedUrl = inv.hosted_invoice_url || null;

    const subject = `Payment failed: ${currency} ${amount}`;
    const html =
      `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">` +
      `<h2>${esc(subject)}</h2>` +
      `<p>We couldn’t take payment for your sponsored listing.</p>` +
      `<p><strong>Business:</strong> ${esc(cleaner?.business_name || "Unknown")}</p>` +
      `<p><strong>Invoice:</strong> ${esc(inv.id)}<br/>` +
      `<strong>Amount due:</strong> ${esc(currency)} ${esc(amount)}</p>` +
      (hostedUrl
        ? `<p><a href="${hostedUrl}" target="_blank" rel="noreferrer">Pay / view invoice</a></p>`
        : "") +
      `<p style="color:#6b7280;font-size:12px">If you believe this is a mistake, try another payment method or contact support.</p>` +
      `</div>`;

    if (toCustomer) await sendResendEmail({ to: toCustomer, subject, html });
    if (adminTo) await sendResendEmail({ to: adminTo, subject: `[ALERT] ${subject}`, html });

    return true;
  } catch (e) {
    console.error("[webhook] notifyPaymentFailed error:", e?.message || e);
    return false;
  }
}

/**
 * ✅ Works even if there is NO usable unique constraint for ON CONFLICT.
 * KEY IMPROVEMENT:
 * - Update by stripe_subscription_id FIRST (most reliable)
 * - Then fall back to business/area/slot if needed
 */
async function upsertSubscription(sub, meta = {}) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;

  const firstItem = sub.items?.data?.[0];
  const price = firstItem?.price;

  // We'll still resolve context so we can populate business/area/slot/category if missing
  const { business_id, area_id, slot, category_id, lock_id } = await resolveContext({
    meta,
    customerId,
  });

  const payload = {
    business_id: business_id || null,
    area_id: area_id || null,
    category_id: category_id || null,
    slot: slot != null ? slot : null,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    price_monthly_pennies: price?.unit_amount ?? null,
    currency: (price?.currency || sub.currency || "gbp")?.toLowerCase(),
    status: sub.status,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
  };

  // 0) ✅ UPDATE BY stripe_subscription_id FIRST
  {
    const { data: rows, error } = await supabase
      .from("sponsored_subscriptions")
      .update({
        // Only overwrite identity fields if we actually have them:
        ...(payload.business_id ? { business_id: payload.business_id } : {}),
        ...(payload.area_id ? { area_id: payload.area_id } : {}),
        ...(payload.slot != null ? { slot: payload.slot } : {}),
        category_id: payload.category_id,
        stripe_customer_id: payload.stripe_customer_id,
        price_monthly_pennies: payload.price_monthly_pennies,
        currency: payload.currency,
        status: payload.status,
        current_period_end: payload.current_period_end,
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_subscription_id", sub.id)
      .select("id");

    if (error) {
      console.error("[webhook] update-by-subid error:", error, { sub_id: sub.id });
    } else if ((rows || []).length > 0) {
      console.log("[webhook] updated sponsored_subscriptions by stripe_subscription_id", {
        sub_id: sub.id,
        status: sub.status,
      });
      await releaseLockSafe(lock_id);
      return;
    }
  }

  // If we don't have business/area/slot we can't safely place it in your model
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

  // 1) UPDATE by (business_id, area_id, slot)
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

  // Try match by stripe_subscription_id
  if (subscriptionId) {
    const { data } = await supabase
      .from("sponsored_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    subRow = data ?? null;
  }

  // If missing, retrieve subscription + upsert, then try again
  if (!subRow && subscriptionId) {
    const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
    await upsertSubscription(stripeSub, stripeSub.metadata || {});
    const { data } = await supabase
      .from("sponsored_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    subRow = data ?? null;
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
}

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

        // Always record invoice row
        await upsertInvoice(inv);

        // Keep subscription status synced after invoice events
        await refreshSubscriptionFromInvoice(inv);

        // ✅ Email rules:
        // - charge_automatically: email only on PAID (receipt), and on PAYMENT_FAILED (failure notice)
        // - send_invoice: email on SENT (manual invoice)
        const collection = inv.collection_method || "charge_automatically";

        if (stripeEvent.type === "invoice.paid" && collection === "charge_automatically") {
          console.log("[webhook] invoice.paid -> createInvoiceAndEmail", inv.id);
          await safeCreateAndEmailInvoice(inv.id, { force: true });
        }

        if (stripeEvent.type === "invoice.payment_failed" && collection === "charge_automatically") {
          console.log("[webhook] invoice.payment_failed -> notifyPaymentFailed", inv.id);
          await notifyPaymentFailed(inv);
        }

        if (stripeEvent.type === "invoice.sent" && collection === "send_invoice") {
          console.log("[webhook] invoice.sent (manual) -> createInvoiceAndEmail", inv.id);
          await safeCreateAndEmailInvoice(inv.id, { force: true });
        }

        // NOTE: We intentionally do NOT email on invoice.finalized for auto-charge
        // because payment may still fail right after.

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
