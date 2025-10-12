// netlify/functions/stripe-postverify.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/stripe-postverify" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { checkout_session } = await req.json().catch(() => ({}));
  if (!checkout_session) return json({ error: "checkout_session required" }, 400);

  try {
    // Expand everything we need regardless of mode
    const session = await stripe.checkout.sessions.retrieve(checkout_session, {
      expand: ["subscription", "subscription.latest_invoice", "payment_intent", "line_items"],
    });

    const meta = session.metadata || {};
    const business_id =
      meta.cleaner_id || meta.business_id || meta.cleanerId || null;
    const area_id = meta.area_id || meta.areaId || null;
    const slot = Number(meta.slot || 1);
    const months = Number(meta.months || 1);

    if (!business_id || !area_id) {
      return json({ error: "Missing metadata: area_id/cleaner_id" }, 400);
    }

    // Common fields
    const stripe_customer_id = session.customer || null;

    if (session.mode === "subscription") {
      // ----- RECURRING -----
      const sub =
        typeof session.subscription === "string"
          ? await stripe.subscriptions.retrieve(session.subscription, {
              expand: ["latest_invoice"],
            })
          : session.subscription;

      // upsert the active subscription
      await supabase.from("sponsored_subscriptions").upsert(
        {
          business_id,
          area_id,
          slot,
          stripe_customer_id,
          stripe_subscription_id: sub?.id || null,
          price_monthly_pennies:
            sub?.items?.data?.[0]?.price?.unit_amount ?? null,
          currency: sub?.currency || "gbp",
          status: sub?.status || "active",
          current_period_end: sub?.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
        },
        { onConflict: "stripe_subscription_id" }
      );

      // store latest invoice if present
      if (sub?.latest_invoice && typeof sub.latest_invoice === "object") {
        const inv = sub.latest_invoice;
        const { data: subRow } = await supabase
          .from("sponsored_subscriptions")
          .select("id")
          .eq("stripe_subscription_id", sub.id)
          .single();

        if (subRow) {
          await supabase.from("sponsored_invoices").upsert(
            {
              sponsored_subscription_id: subRow.id,
              stripe_invoice_id: inv.id,
              hosted_invoice_url: inv.hosted_invoice_url,
              invoice_pdf: inv.invoice_pdf,
              amount_due_pennies: inv.amount_due,
              currency: inv.currency,
              status: inv.status,
              period_start: inv.period_start
                ? new Date(inv.period_start * 1000).toISOString()
                : null,
              period_end: inv.period_end
                ? new Date(inv.period_end * 1000).toISOString()
                : null,
            },
            { onConflict: "stripe_invoice_id" }
          );
        }
      }
    } else {
      // ----- ONE-OFF PAYMENT (prepay N months) -----
      // there is no subscription object; treat it as an "active" sponsorship
      const pi =
        typeof session.payment_intent === "string"
          ? await stripe.paymentIntents.retrieve(session.payment_intent)
          : session.payment_intent;

      await supabase.from("sponsored_subscriptions").upsert(
        {
          business_id,
          area_id,
          slot,
          // store customer for portal access
          stripe_customer_id,
          // no subscription id in one-off flow
          stripe_subscription_id: null,
          stripe_payment_intent_id: pi?.id || null,
          price_monthly_pennies: Number(meta.monthly_price_pennies) || null,
          currency: (pi && pi.currency) || "gbp",
          status: "active", // treat as active so the slot paints and buttons disable
          // optional: you could compute an expiry based on months if you later enforce it
          // current_period_end: null,
          months_prepaid: Number.isFinite(months) ? months : 1,
          checkout_session_id: session.id,
        },
        // no unique subscription id to conflict on; use composite key via a unique index if you add one
        { onConflict: undefined }
      );
    }

    return json({ ok: true });
  } catch (e) {
    console.error("[stripe-postverify] error", e);
    return json({ error: e?.message || "postverify failed" }, 500);
  }
};
