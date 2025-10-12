// netlify/functions/billing-portal.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const PORTAL_CONFIG_ID = process.env.STRIPE_PORTAL_CONFIGURATION_ID || null;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function siteBase() {
  return (process.env.PUBLIC_SITE_URL || "http://localhost:5173").replace(/\/+$/, "");
}

/**
 * POST body: { cleanerId: "<uuid>", email?: "<prefill>" }
 */
export default async (req) => {
  // Helpful GET so you can hit it in the browser and confirm deploy
  if (req.method === "GET") {
    return json({ ok: true, note: "billing-portal is deployed. Use POST with { cleanerId }." });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const { cleanerId, email } = await req.json();
    if (!cleanerId) return json({ error: "cleanerId required" }, 400);

    // 1) Try existing customer id from subscriptions
    let stripeCustomerId = null;
    {
      const { data } = await supabase
        .from("sponsored_subscriptions")
        .select("stripe_customer_id")
        .eq("business_id", cleanerId)
        .not("stripe_customer_id", "is", null)
        .limit(1);
      if (data?.length && data[0].stripe_customer_id) {
        stripeCustomerId = data[0].stripe_customer_id;
      }
    }

    // 2) Fall back to cleaners row
    let cleanerRow = null;
    if (!stripeCustomerId) {
      const { data } = await supabase
        .from("cleaners")
        .select("stripe_customer_id, business_name, address, user_id")
        .eq("id", cleanerId)
        .maybeSingle();
      cleanerRow = data || null;
      if (cleanerRow?.stripe_customer_id) {
        stripeCustomerId = cleanerRow.stripe_customer_id;
      }
    }

    // 3) If still not found, find-by-email or create a Customer
    if (!stripeCustomerId) {
      let resolvedEmail = email || null;
      if (!resolvedEmail && cleanerRow?.user_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", cleanerRow.user_id)
          .maybeSingle();
        if (profile?.email) resolvedEmail = profile.email;
      }

      if (resolvedEmail) {
        const list = await stripe.customers.list({ email: resolvedEmail, limit: 1 });
        if (list.data.length) {
          stripeCustomerId = list.data[0].id;
        }
      }

      if (!stripeCustomerId) {
        const created = await stripe.customers.create({
          email: resolvedEmail || undefined,
          name: cleanerRow?.business_name || undefined,
          metadata: { cleaner_id: cleanerId },
        });
        stripeCustomerId = created.id;
      }

      // Persist on cleaners for future lookups (best effort)
      if (stripeCustomerId && (!cleanerRow || cleanerRow.stripe_customer_id !== stripeCustomerId)) {
        await supabase
          .from("cleaners")
          .update({ stripe_customer_id: stripeCustomerId })
          .eq("id", cleanerId);
      }
    }

    if (!stripeCustomerId) {
      return json({ error: "No customer found" }, 404);
    }

    // 4) Create Billing Portal session
    const payload = {
      customer: stripeCustomerId,
      return_url: `${siteBase()}/#/dashboard`,
    };
    if (PORTAL_CONFIG_ID) payload.configuration = PORTAL_CONFIG_ID;

    const portal = await stripe.billingPortal.sessions.create(payload);
    return json({ url: portal.url });
  } catch (e) {
    console.error("[billing-portal] error:", e);
    return json({ error: e?.message || "failed to create portal session" }, 500);
  }
};
