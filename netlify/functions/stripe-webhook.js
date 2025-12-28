// netlify/functions/stripe-webhook.js
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

// Netlify Functions (Node 18+) normally has global fetch.
// This fallback prevents silent failures if your bundler/runtime differs.
let fetchFn = global.fetch;
if (!fetchFn) {
  try {
    // Optional dependency: only needed if fetch isn't available
    // npm i node-fetch@3  (or rely on Node18 global fetch)
    // Note: node-fetch@3 is ESM; require may fail depending on your setup.
    // If require fails, we’ll warn and skip calling createInvoiceAndEmail.
    // eslint-disable-next-line import/no-extraneous-dependencies
    fetchFn = require("node-fetch");
  } catch (e) {
    console.warn(
      "[webhook] fetch is not available and node-fetch is not installed. createInvoiceAndEmail trigger will be skipped."
    );
    fetchFn = null;
  }
}

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

function normStatus(s) {
  return String(s || "").toLowerCase();
}

async function resolveContext({ meta, customerId }) {
  const business_id =
    meta?.business_id || meta?.cleaner_id || meta?.businessId || null;
  const area_id = meta?.area_id || meta?.areaId || null;
  const slot = meta?.slot != null ? Number(meta.slot) : null;
  const category_id = meta?.category_id || meta?.categoryId || null;
  const lock_id = meta?.lock_id || null;

  if (business_id && area_id && slot != null) {
    return { business_id, area_id, slot, category_id: category_id || null, lock_id };
  }

  // fallback by customerId -> cleaners.stripe_customer_id
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

async function cancelStripeSubscriptionSafe(subId, reason) {
  if (!subId) return;
  try {
    console.warn("[webhook] canceling subscription:", subId, reason || "");
    await stripe.subscriptions.cancel(subId);
  } catch (e) {
    console.error("[webhook] failed to cancel subscription:", subId, e);
  }
}

async function releaseLockSafe(lockId) {
  if (!lockId) return;
  try {
    await supabase
      .from("sponsored_locks")
      .update({ is_active: false })
      .eq("id", lockId);
  } catch (e) {
    console.error("[webhook] failed to release lock:", lockId, e);
  }
}

async function upsertSubscription(sub, meta = {}) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;

  const { business_id, area_id, slot, category_id, lock_id } = await resolveContext({
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

    // ✅ this powers the 72h renewal reminder
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
  };

  const { error } = await supabase
    .from("sponsored_subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  if (error) {
    const msg = String(error?.message || "").toLowerCase();
    const code = String(error?.code || "").toLowerCase();

    console.error("[webhook] upsert sponsored_subscriptions error:", error, payload);

    // overlap trigger raises errcode 23505 — cancel subscription to avoid charging
    if (
      code === "23505" ||
      msg.includes("overlaps an existing sponsored area") ||
      msg.includes("overlaps an existing sponsored") ||
      msg.includes("duplicate") ||
      msg.includes("unique")
    ) {
      await cancelStripeSubscriptionSafe(sub.id, "Overlap/uniqueness violation");
      await releaseLockSafe(lock_id);
      return; // swallow so Stripe doesn't retry forever
    }

    throw new Error("DB upsert(sponsored_subscriptions) failed");
  }

  // if successful, release lock (checkout complete)
  await releaseLockSafe(lock_id);
}

async function upsertInvoice(inv) {
  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

  let { data: subRow, error: findErr } = await supabase
    .from("sponsored_subscriptions")
    .select("id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (findErr) {
    console.error("[webhook] find sub for invoice error:", findErr);
    throw new Error("DB find(sub) for invoice failed");
  }

  // If invoice arrives before subscription row exists, hydrate it
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
    period_start: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
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

// ✅ Trigger your custom invoice generator (branding + km2 + rate breakdown)
// IMPORTANT: we do NOT block the webhook response on this.
async function triggerCustomInvoicePdf(stripeInvoiceId) {
  if (!stripeInvoiceId) return;

  // If fetch isn't available (and node-fetch isn't installed), skip gracefully
  if (!fetchFn) {
    console.warn("[webhook] fetch not available; skipping createInvoiceAndEmail trigger.");
    return;
  }

  const base =
    process.env.PUBLIC_SITE_URL ||
    process.env.URL || // Netlify auto env
    "";

  if (!base) {
    console.warn("[webhook] No PUBLIC_SITE_URL/URL set, cannot trigger custom invoice function.");
    return;
  }

  const url = `${base.replace(/\/$/, "")}/.netlify/functions/createInvoiceAndEmail`;

  try {
    const resp = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stripe_invoice_id: stripeInvoiceId }),
    });

    const txt = await resp.text().catch(() => "");
    if (!resp.ok) {
      console.error("[webhook] createInvoiceAndEmail failed", resp.status, txt);
    } else {
      console.log("[webhook] createInvoiceAndEmail ok", stripeInvoiceId, txt);
    }
  } catch (e) {
    console.error("[webhook] error calling createInvoiceAndEmail:", e);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json(200, { ok: true, note: "Stripe webhook is deployed. Use POST from Stripe." });
  }
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

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
          .update({ status: "canceled" })
          .eq("stripe_subscription_id", sub.id);

        if (error) {
          console.error("[webhook] cancel sub error:", error);
          throw new Error("DB cancel(sub) failed");
        }
        break;
      }

      case "invoice.finalized":
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.voided": {
        const inv = stripeEvent.data.object;

        await upsertInvoice(inv);

        // ✅ ONLY create our custom invoice/PDF on finalized (one-time)
        // ✅ DO NOT block the webhook response (Stripe retries on slow handlers)
        if (stripeEvent.type === "invoice.finalized") {
          triggerCustomInvoicePdf(inv.id); // intentionally NOT awaited
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
