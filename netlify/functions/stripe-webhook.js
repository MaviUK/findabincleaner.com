// netlify/functions/stripe-webhook.js
console.log("LOADED stripe-webhook v2026-01-06-SPONSOR-REMAINING-GEOM-FIX");

const Stripe = require("stripe");
const { getSupabaseAdmin } = require("./_lib/supabase");

const {
  createInvoiceAndEmailByStripeInvoiceId,
} = require("./_lib/createInvoiceCore");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// IMPORTANT: Use lazy client creation to avoid import-time crashes when env vars are missing.
const supabase = () => getSupabaseAdmin();

const json = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// ----------------------------
// Email helpers (Resend)
// ----------------------------
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendPaymentFailedEmail(inv) {
  try {
    const { RESEND_API_KEY, BILLING_FROM } = process.env;
    if (!RESEND_API_KEY || !BILLING_FROM) {
      console.warn(
        "[webhook] missing RESEND_API_KEY or BILLING_FROM; skipping failed-payment email"
      );
      return;
    }

    const subId =
      typeof inv.subscription === "string"
        ? inv.subscription
        : inv.subscription?.id ?? null;

    // Try to resolve businessId from subscription metadata
    let businessId = null;
    if (subId) {
      const sub = await stripe.subscriptions.retrieve(subId);
      const meta = sub?.metadata || {};
      businessId = meta.business_id || meta.cleaner_id || meta.businessId || null;
    }

    if (!businessId) {
      console.warn("[webhook] payment_failed: could not resolve businessId from metadata", {
        invoice: inv.id,
        subId,
      });
      return;
    }

    const { data: cleaner, error: cErr } = await supabase()
      .from("cleaners")
      .select("business_name, contact_email")
      .eq("id", businessId)
      .maybeSingle();

    if (cErr || !cleaner?.contact_email) {
      console.warn("[webhook] payment_failed: no contact_email found", { businessId, cErr });
      return;
    }

    const pennies = inv.amount_due ?? inv.amount_remaining ?? 0;
    const amount = Number(pennies || 0) / 100;
    const currency = String(inv.currency || "gbp").toUpperCase();
    const hosted = inv.hosted_invoice_url || "";

    const subject = `Payment failed — action needed (${currency} ${amount.toFixed(2)})`;

    const html =
      `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">` +
      `<h2>${escapeHtml(subject)}</h2>` +
      `<p>Hi ${escapeHtml(cleaner.business_name || "there")},</p>` +
      `<p>We couldn’t take payment for your <strong>Featured service area</strong> subscription.</p>` +
      `<p><strong>Invoice:</strong> ${escapeHtml(inv.number || inv.id)}<br/>` +
      `<strong>Amount due:</strong> ${currency} ${amount.toFixed(2)}</p>` +
      (hosted
        ? `<p><a href="${hosted}" target="_blank" rel="noreferrer">Pay now / update payment method</a></p>`
        : `<p>Please update your payment method in Stripe.</p>`) +
      `<p style="color:#6b7280;font-size:12px;margin-top:20px">Find a Bin Cleaner — Billing</p>` +
      `</div>`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: BILLING_FROM,
        to: cleaner.contact_email,
        subject,
        html,
      }),
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.error("[webhook] Resend failed-payment email error:", txt || r.statusText);
    } else {
      console.log("[webhook] sent payment_failed email to", cleaner.contact_email);
    }
  } catch (e) {
    console.error("[webhook] sendPaymentFailedEmail failed:", e?.message || e);
  }
}

// ----------------------------
// Context + locking
// ----------------------------
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
    const { data } = await supabase()
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
    await supabase().from("sponsored_locks").update({ is_active: false }).eq("id", lockId);
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
    const msg = String(e?.message || "");
    if (msg.includes("No such subscription")) {
      console.warn("[webhook] subscription already gone:", subId);
      return;
    }
    console.error("[webhook] failed to cancel subscription:", subId, msg);
  }
}


// ----------------------------
// Sponsorship geometry rules
// ----------------------------
const HOLDING_STATUSES = new Set(["active", "trialing", "past_due"]);
const NON_HOLDING_STATUSES = new Set([
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
  "canceled",
  "cancelled",
]);

const EPS = 1e-6;

async function fetchRemainingGeomEWKT({ area_id, category_id, slot }) {
  // MUST use the INTERNAL function that returns remaining geometry + ewkt
  const { data, error } = await supabase().rpc("area_remaining_preview_internal", {
    p_area_id: area_id,
    p_category_id: category_id,
    p_slot: Number(slot),
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { sold_out: true, available_km2: 0, ewkt: null, reason: "area_not_found" };

  const available_km2 = Number(row.available_km2 ?? 0) || 0;
  const sold_out =
    Boolean(row.sold_out) || !Number.isFinite(available_km2) || available_km2 <= EPS;

  return {
    sold_out,
    available_km2: Math.max(0, available_km2),
    ewkt: row.ewkt || null,
    reason: row.reason || (sold_out ? "no_remaining" : "ok"),
  };
}

/**
 * ✅ KEY FIXES IN THIS VERSION:
 * - When status is ACTIVE/TRIALING/PAST_DUE -> we MUST set sponsored_geom to REMAINING geom EWKT.
 * - When status is NOT holding -> we MUST set sponsored_geom = null (release area).
 * - If remaining is sold out -> cancel subscription + do not hold area.
 * - Cancel on DB overlap errors (P0001 overlap trigger), not only 23505.
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

  if (!category_id) {
    console.error("[webhook] missing category_id in metadata — cannot compute remaining geom", {
      sub_id: sub.id,
      business_id,
      area_id,
      slot,
      meta,
    });
    await releaseLockSafe(lock_id);
    return;
  }

  const firstItem = sub.items?.data?.[0];
  const price = firstItem?.price;

  const status = String(sub.status || "").toLowerCase();

  // Determine what sponsored_geom should be for this status
  let sponsored_geom_ewkt = null;

  if (HOLDING_STATUSES.has(status)) {
    const rem = await fetchRemainingGeomEWKT({ area_id, category_id, slot });

    // Sold out or no ewkt -> cancel subscription and do not hold geom
    if (rem.sold_out || !rem.ewkt) {
      console.warn("[webhook] no remaining area at activation; canceling", {
        sub_id: sub.id,
        business_id,
        area_id,
        slot,
        category_id,
        available_km2: rem.available_km2,
        reason: rem.reason,
      });

      await cancelStripeSubscriptionSafe(sub.id, "no_remaining");

      // also release any lock
      await releaseLockSafe(lock_id);

      // best-effort: if a row already exists, clear sponsored_geom
      try {
        await supabase()
          .from("sponsored_subscriptions")
          .update({
            status: "canceled",
            sponsored_geom: null,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", sub.id);
      } catch (_) {}

      return;
    }

    sponsored_geom_ewkt = rem.ewkt;
  } else if (NON_HOLDING_STATUSES.has(status)) {
    sponsored_geom_ewkt = null;
  } else {
    // Unknown status -> be safe: do not hold area
    sponsored_geom_ewkt = null;
  }

  const payload = {
    business_id,
    area_id,
    category_id: category_id || null,
    slot,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    price_monthly_pennies: price?.unit_amount ?? null,
    currency: (price?.currency || sub.currency || "gbp")?.toLowerCase(),
    status,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
    // 🔥 THE IMPORTANT FIELD:
    // - if holding -> EWKT of REMAINING
    // - else -> null (release)
    sponsored_geom: sponsored_geom_ewkt,
  };

  // 0) Idempotency: if we already have this Stripe subscription id, just update and exit.
  {
    const { data: existing, error: exErr } = await supabase()
      .from("sponsored_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", sub.id)
      .maybeSingle();

    if (exErr) {
      console.warn("[webhook] lookup by stripe_subscription_id failed; continuing", exErr);
    } else if (existing?.id) {
      const { error: updByStripeErr } = await supabase()
        .from("sponsored_subscriptions")
        .update({
          status: payload.status,
          current_period_end: payload.current_period_end,
          stripe_customer_id: payload.stripe_customer_id,
          price_monthly_pennies: payload.price_monthly_pennies,
          currency: payload.currency,
          category_id: payload.category_id,
          sponsored_geom: payload.sponsored_geom, // ✅ ensure correct geom on updates
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updByStripeErr) {
        console.error("[webhook] update-by-stripe_subscription_id failed", updByStripeErr);
        // fall through
      } else {
        await releaseLockSafe(lock_id);
        return;
      }
    }
  }

  // 1) UPDATE first (by business+area+slot)
  const { data: updatedRows, error: updErr } = await supabase()
    .from("sponsored_subscriptions")
    .update({
      stripe_customer_id: payload.stripe_customer_id,
      stripe_subscription_id: payload.stripe_subscription_id,
      price_monthly_pennies: payload.price_monthly_pennies,
      currency: payload.currency,
      status: payload.status,
      current_period_end: payload.current_period_end,
      category_id: payload.category_id,
      sponsored_geom: payload.sponsored_geom, // ✅ critical
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
      status: payload.status,
    });
    await releaseLockSafe(lock_id);
    return;
  }

  // 2) INSERT if no row was updated
  const { error: insErr } = await supabase().from("sponsored_subscriptions").insert({
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
      status: payload.status,
    });
    await releaseLockSafe(lock_id);
    return;
  }

  console.error("[webhook] insert sponsored_subscriptions error:", insErr, payload);

  // 3) If insert fails due to overlap trigger, cancel subscription
  const msg = String(insErr?.message || "").toLowerCase();
  const code = String(insErr?.code || "").toUpperCase();

  const looksLikeOverlap =
    msg.includes("area overlaps") ||
    msg.includes("overlaps an existing") ||
    msg.includes("overlaps:") ||
    msg.includes("sponsorship exceeds available");

  // Supabase RAISE EXCEPTION in trigger typically shows as P0001 (not 23505)
  if (looksLikeOverlap && (code === "P0001" || code === "23505")) {
    await cancelStripeSubscriptionSafe(sub.id, "Overlap violation");
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
    const { data, error } = await supabase()
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

    const { data, error } = await supabase()
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

  // 3) Fallback: use metadata identity (business_id + area_id + slot)
  if (!subRow && subscriptionId) {
    if (!stripeSub) stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
    const meta = stripeSub.metadata || {};

    const business_id = meta.business_id || meta.cleaner_id || meta.businessId || null;
    const area_id = meta.area_id || meta.areaId || null;
    const slot = meta.slot != null ? Number(meta.slot) : null;

    if (business_id && area_id && slot != null) {
      const { data, error } = await supabase()
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

  const { error } = await supabase()
    .from("sponsored_invoices")
    .upsert(payload, { onConflict: "stripe_invoice_id" });

  if (error) {
    console.error("[webhook] upsert sponsored_invoices error:", error, payload);
    throw new Error("DB upsert(sponsored_invoices) failed");
  }
}

/**
 * Pull the subscription from Stripe and upsert it on invoice events.
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
          // IMPORTANT: session.metadata has the area_id/category_id/slot set by checkout
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

        // ✅ CRITICAL: release the held area when subscription is deleted
        const { error } = await supabase()
          .from("sponsored_subscriptions")
          .update({
            status: "canceled",
            sponsored_geom: null,
            current_period_end: sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : null,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", sub.id);

        if (error) throw new Error("DB cancel(sub) failed");
        break;
      }

      // ----------------------------
      // Invoice lifecycle
      // ----------------------------
      case "invoice.finalized":
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.voided":
      case "invoice.sent": {
        const inv = stripeEvent.data.object;

        // Always record invoice row
        await upsertInvoice(inv);

        // Always refresh subscription state from Stripe
        await refreshSubscriptionFromInvoice(inv);

        // Only send your invoice email when PAID
        if (stripeEvent.type === "invoice.paid") {
          console.log("[webhook] invoice.paid -> createInvoiceAndEmail", inv.id);
          await safeCreateAndEmailInvoice(inv.id, { force: true });
        }

        // If payment failed: send a “payment failed” email instead (with pay link)
        if (stripeEvent.type === "invoice.payment_failed") {
          console.log("[webhook] invoice.payment_failed -> notify customer", inv.id);
          await sendPaymentFailedEmail(inv);
        }

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
