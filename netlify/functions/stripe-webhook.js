// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

/**
 * This function owns a first-class URL (no redirects involved) and receives the
 * RAW body so Stripe signatures verify.
 *
 * Health check (GET in a browser):
 *   https://<your-site>/api/stripe/webhook
 */
export const config = {
  path: "/api/stripe/webhook", // <- serve directly at /api/stripe/webhook
  body: "raw", // <- raw body required for signature verification
};

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

if (!STRIPE_SECRET_KEY) console.error("[stripe-webhook] Missing STRIPE_SECRET_KEY");
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE)
  console.error("[stripe-webhook] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE");
if (!STRIPE_WEBHOOK_SECRET) console.error("[stripe-webhook] Missing STRIPE_WEBHOOK_SECRET");

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/* ----------------------------- helpers ---------------------------------- */

function cleanId(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function resolveContext({ meta, customerId }) {
  // ✅ accept both snake_case + camelCase
  const business_id = cleanId(meta?.cleaner_id ?? meta?.business_id ?? meta?.businessId);
  const area_id = cleanId(meta?.area_id ?? meta?.areaId);
  const slot = meta?.slot != null ? Number(meta.slot) : null;

  // ✅ NEW: category_id for per-industry sponsorship
  const category_id = cleanId(meta?.category_id ?? meta?.categoryId);

  if (business_id && area_id && Number.isFinite(slot)) {
    return { business_id, area_id, slot, category_id };
  }

  // Fall back via cleaners.stripe_customer_id
  if (customerId) {
    const { data, error } = await supabase
      .from("cleaners")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    if (error) console.error("[webhook] resolveContext error:", error);

    if (data?.id) {
      // We can at least attach business_id for later debugging.
      // area_id/slot/category_id may be missing if metadata wasn't provided.
      return { business_id: data.id, area_id: null, slot: null, category_id: null };
    }
  }

  return { business_id: null, area_id: null, slot: null, category_id: null };
}

async function upsertSubscription(sub, meta = {}) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;

  // IMPORTANT:
  // Prefer Stripe's subscription metadata when present (it persists),
  // but allow the event-provided meta to fill gaps.
  const mergedMeta = { ...(sub.metadata || {}), ...(meta || {}) };

  const { business_id, area_id, slot, category_id } = await resolveContext({
    meta: mergedMeta,
    customerId,
  });

  const firstItem = sub.items?.data?.[0];
  const price = firstItem?.price;

  const payload = {
    business_id,
    area_id,
    slot: slot ?? null,

    // ✅ NEW
    category_id: category_id ?? null,

    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    price_monthly_pennies: price?.unit_amount ?? null,
    currency: (price?.currency || sub.currency || "gbp")?.toLowerCase(),
    status: sub.status,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
  };

  const { error } = await supabase
    .from("sponsored_subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  if (error) {
    console.error("[webhook] upsert sub error:", error, payload);
    throw new Error("DB upsert(sub) failed");
  }
}

async function upsertInvoice(inv) {
  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

  // Ensure we have a subscription row. If not, retrieve from Stripe and insert it.
  let { data: subRow, error: findErr } = await supabase
    .from("sponsored_subscriptions")
    .select("id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (findErr) {
    console.error("[webhook] find sub for invoice error:", findErr);
    throw new Error("DB find(sub) for invoice failed");
  }

  if (!subRow && subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["customer", "items.data.price.product"],
      });

      // ✅ This uses sub.metadata (which should contain category_id if checkout set it)
      await upsertSubscription(sub, sub.metadata || {});

      // Re-fetch the row id for FK
      const refetch = await supabase
        .from("sponsored_subscriptions")
        .select("id")
        .eq("stripe_subscription_id", subscriptionId)
        .maybeSingle();
      subRow = refetch.data ?? null;
    } catch (e) {
      console.error("[webhook] could not retrieve+insert subscription for invoice:", e);
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
  };

  const { error } = await supabase
    .from("sponsored_invoices")
    .upsert(payload, { onConflict: "stripe_invoice_id" });

  if (error) {
    console.error("[webhook] upsert invoice error:", error, payload);
    throw new Error("DB upsert(invoice) failed");
  }

  // Mirror minimal invoice status back to the subscription row
  if (subRow?.id) {
    let mirror = null;
    if (inv.status === "paid") mirror = "active";
    else if (["open", "void"].includes(inv.status)) mirror = inv.status;

    if (mirror) {
      const { error: updErr } = await supabase
        .from("sponsored_subscriptions")
        .update({ status: mirror })
        .eq("id", subRow.id);

      if (updErr) {
        console.error("[webhook] update sub status error:", updErr);
        throw new Error("DB update(sub status) failed");
      }
    }
  }
}

/* ----------------------------- handler ---------------------------------- */

export default async (req) => {
  // Health check for browsers
  if (req.method === "GET") {
    return json({ ok: true, note: "Stripe webhook is deployed. Use POST from Stripe." });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const sig = req.headers.get("stripe-signature");
  if (!sig) return json({ error: "Missing Stripe signature header" }, 400);

  let event;
  try {
    const raw = await req.text(); // RAW body is required
    event = stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[webhook] bad signature:", err?.message);
    return json({ error: "Bad signature" }, 400);
  }

  try {
    console.log(`[webhook] ${event.type} id=${event.id}`);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        if (session.mode === "subscription" && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription, {
            expand: ["latest_invoice", "customer", "items.data.price.product"],
          });

          // ✅ session.metadata should include category_id from checkout
          await upsertSubscription(sub, session.metadata || {});

          if (sub.latest_invoice && typeof sub.latest_invoice === "object") {
            await upsertInvoice(sub.latest_invoice);
          }
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;

        // ✅ sub.metadata should contain category_id if set at checkout
        await upsertSubscription(sub, sub.metadata || {});
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;

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
        await upsertInvoice(event.data.object);
        break;
      }

      default:
        break;
    }

    return json({ ok: true });
  } catch (e) {
    console.error("[webhook] handler error:", e);
    return json({ error: e?.message || "Server error" }, 500);
  }
};
