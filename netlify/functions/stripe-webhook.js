// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// GET is handy to confirm the function is deployed in a browser.
// Stripe will POST real events.
export default async (req) => {
  // Health check in browser
  if (req.method === "GET") {
    return json({ ok: true, note: "Stripe webhook is deployed. Use POST from Stripe." });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ----- Verify Stripe signature -----
  const sig = req.headers.get("stripe-signature");
  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: "Missing Stripe signature or STRIPE_WEBHOOK_SECRET" }, 400);
  }

  let event;
  try {
    const raw = await req.text(); // raw body required for signature verification
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[webhook] bad signature:", err?.message);
    return json({ error: "Bad signature" }, 400);
  }

  try {
    // --- Handle a couple of key events (extend as needed) ---
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // Optional: fetch full subscription (if present) to capture price/invoice, etc.
      if (session.mode === "subscription" && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription, { expand: ["latest_invoice"] });

        // Upsert a lightweight row so you can confirm webhook is writing to DB
        await supabase.from("sponsored_subscriptions").upsert({
          business_id: session.metadata?.cleaner_id ?? null,
          area_id: session.metadata?.area_id ?? null,
          slot: Number(session.metadata?.slot ?? 1),
          stripe_customer_id: sub.customer,
          stripe_subscription_id: sub.id,
          price_monthly_pennies: sub.items?.data?.[0]?.price?.unit_amount ?? null,
          currency: sub.currency ?? "gbp",
          status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        }, { onConflict: "stripe_subscription_id" });

        if (sub.latest_invoice && typeof sub.latest_invoice === "object") {
          const inv = sub.latest_invoice;
          // Look up the row we just upserted to link invoice
          const { data: subRow } = await supabase
            .from("sponsored_subscriptions")
            .select("id")
            .eq("stripe_subscription_id", sub.id)
            .single();

          if (subRow) {
            await supabase.from("sponsored_invoices").upsert({
              sponsored_subscription_id: subRow.id,
              stripe_invoice_id: inv.id,
              hosted_invoice_url: inv.hosted_invoice_url,
              invoice_pdf: inv.invoice_pdf,
              amount_due_pennies: inv.amount_due,
              currency: inv.currency,
              status: inv.status,
              period_start: new Date(inv.period_start * 1000).toISOString(),
              period_end: new Date(inv.period_end * 1000).toISOString(),
            }, { onConflict: "stripe_invoice_id" });
          }
        }
      }
    }

    // Keep Stripe happy with a fast 200
    return json({ ok: true });
  } catch (e) {
    console.error("[webhook] handler error:", e);
    return json({ error: e?.message || "Webhook error" }, 500);
  }
};
