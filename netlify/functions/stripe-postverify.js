// netlify/functions/stripe-postverify.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/stripe-postverify" };

if (!process.env.STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY");
if (!process.env.SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!process.env.SUPABASE_SERVICE_ROLE) throw new Error("Missing SUPABASE_SERVICE_ROLE");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function toISO(secOrMs) {
  if (!secOrMs) return null;
  const ms = String(secOrMs).length <= 10 ? Number(secOrMs) * 1000 : Number(secOrMs);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const checkoutSessionId = body?.checkout_session;
  if (!checkoutSessionId) {
    return json({ error: "checkout_session required" }, 400);
  }

  try {
    // Get the session with everything we may need expanded
    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
      expand: ["subscription", "subscription.latest_invoice", "payment_intent", "line_items"],
    });

    const meta = session.metadata || {};
    const business_id = meta.cleaner_id || meta.business_id || meta.cleanerId || null;
    const area_id = meta.area_id || meta.areaId || null;
    const slot = Number(meta.slot ?? 1) || 1;
    const months = Number(meta.months ?? 1) || 1;
    const monthly_price_pennies =
      Number(meta.monthly_price_pennies ?? meta.monthly_pennies ?? NaN);
    const stripe_customer_id =
      typeof session.customer === "string" ? session.customer : session.customer?.id || null;

    if (!business_id || !area_id) {
      return json({ error: "Missing metadata: area_id/cleaner_id" }, 400);
    }

    if (session.mode === "subscription" && session.subscription) {
      // --------- RECURRING SUBSCRIPTION ----------
      const sub =
        typeof session.subscription === "string"
          ? await stripe.subscriptions.retrieve(session.subscription, { expand: ["latest_invoice"] })
          : session.subscription;

      const unit_amount = sub?.items?.data?.[0]?.price?.unit_amount ?? null;

      const upsertPayload = {
        business_id,
        area_id,
        slot,
        status: sub?.status || "active",
        currency: sub?.currency || "gbp",
        price_monthly_pennies: unit_amount,
        stripe_customer_id,
        stripe_subscription_id: sub?.id || null,
        current_period_end: toISO(sub?.current_period_end),
        checkout_session_id: session.id,
      };

      const { error: upErr } = await supabase
        .from("sponsored_subscriptions")
        .upsert(upsertPayload, { onConflict: "stripe_subscription_id" });
      if (upErr) throw upErr;

      // Also store latest invoice if available
      if (sub?.latest_invoice && typeof sub.latest_invoice === "object") {
        const inv = sub.latest_invoice;

        const { data: subRow } = await supabase
          .from("sponsored_subscriptions")
          .select("id")
          .eq("stripe_subscription_id", sub.id)
          .maybeSingle();

        if (subRow?.id) {
          const invPayload = {
            sponsored_subscription_id: subRow.id,
            stripe_invoice_id: inv.id,
            hosted_invoice_url: inv.hosted_invoice_url || null,
            invoice_pdf: inv.invoice_pdf || null,
            amount_due_pennies: inv.amount_due ?? null,
            currency: inv.currency || "gbp",
            status: inv.status || null,
            period_start: toISO(inv.period_start),
            period_end: toISO(inv.period_end),
          };
          const { error: invErr } = await supabase
            .from("sponsored_invoices")
            .upsert(invPayload, { onConflict: "stripe_invoice_id" });
          if (invErr) throw invErr;
        }
      }
    } else {
      // --------- ONE-OFF PAYMENT (PREPAY) ----------
      const pi =
        typeof session.payment_intent === "string"
          ? await stripe.paymentIntents.retrieve(session.payment_intent)
          : session.payment_intent;

      const upsertPayload = {
        business_id,
        area_id,
        slot,
        status: "active", // treat prepay as active
        currency: (pi && pi.currency) || "gbp",
        price_monthly_pennies: Number.isFinite(monthly_price_pennies) ? monthly_price_pennies : null,
        stripe_customer_id,
        stripe_payment_intent_id: pi?.id || null,
        months_prepaid: Number.isFinite(months) ? months : 1,
        checkout_session_id: session.id,
      };

      const { error: upErr } = await supabase.from("sponsored_subscriptions").upsert(upsertPayload);
      if (upErr) throw upErr;
    }

    return json({ ok: true });
  } catch (e) {
    console.error("[stripe-postverify] error", e);
    return json({ error: e?.message || "postverify failed" }, 500);
  }
};
