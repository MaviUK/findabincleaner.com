// netlify/functions/billing-portal.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Server-side Supabase (service role, since this runs on Netlify)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const PORTAL_CONFIG_ID = process.env.STRIPE_PORTAL_CONFIGURATION_ID || null;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function siteBase() {
  return (process.env.PUBLIC_SITE_URL || "http://localhost:5173").replace(/\/+$/, "");
}

/**
 * POST body:
 * { cleanerId: "<uuid>", email?: "<prefill>" }
 */
export default async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return json({ ok: true });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const { cleanerId, email } = await req.json();
    if (!cleanerId) return json({ error: "cleanerId required" }, 400);

    // ---------------------------
    // 1) Load cleaner (canonical place for stripe_customer_id)
    // ---------------------------
    const { data: cleaner, error: cleanerErr } = await supabase
      .from("cleaners")
      .select("id, user_id, business_name, address, stripe_customer_id")
      .eq("id", cleanerId)
      .maybeSingle();

    if (cleanerErr) throw cleanerErr;
    if (!cleaner) return json({ error: "Cleaner not found" }, 404);

    let stripeCustomerId = cleaner.stripe_customer_id || null;

    // ---------------------------
    // 2) Fallback: look at subscriptions table (if you have legacy rows)
    // ---------------------------
    if (!stripeCustomerId) {
      const { data: subRows, error: subErr } = await supabase
        .from("sponsored_subscriptions")
        .select("stripe_customer_id")
        .eq("business_id", cleanerId)
        .not("stripe_customer_id", "is", null)
        .limit(1);
      if (subErr) throw subErr;
      if (subRows?.length) {
        stripeCustomerId = subRows[0].stripe_customer_id;
      }
    }

    // ---------------------------
    // 3) If still not found, find-by-email or create a Stripe Customer
    // ---------------------------
    if (!stripeCustomerId) {
      // Resolve an email to associate with the customer
      let resolvedEmail = email || null;
      if (!resolvedEmail && cleaner.user_id) {
        const { data: profile, error: profErr } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", cleaner.user_id)
          .maybeSingle();
        if (profErr) throw profErr;
        if (profile?.email) resolvedEmail = profile.email;
      }

      // Try to find an existing customer with that email
      if (resolvedEmail) {
        const found = await stripe.customers.list({ email: resolvedEmail, limit: 1 });
        if (found.data.length) {
          stripeCustomerId = found.data[0].id;
        }
      }

      // Create one if still missing
      if (!stripeCustomerId) {
        const created = await stripe.customers.create({
          email: resolvedEmail || undefined,
          name: cleaner.business_name || undefined,
          metadata: { cleaner_id: cleanerId },
        });
        stripeCustomerId = created.id;
      }

      // Persist the Stripe customer id on the cleaner for future calls (best effort)
      if (stripeCustomerId) {
        await supabase
          .from("cleaners")
          .update({ stripe_customer_id: stripeCustomerId })
          .eq("id", cleanerId);
      }
    }

    if (!stripeCustomerId) {
      return json({ error: "No customer found or created" }, 404);
    }

    // ---------------------------
    // 4) Create Billing Portal session
    // ---------------------------
    const payload = {
      customer: stripeCustomerId,
      return_url: `${siteBase()}/#/dashboard`,
    };
    if (PORTAL_CONFIG_ID) {
      payload.configuration = PORTAL_CONFIG_ID; // optional but recommended
    }

    const portal = await stripe.billingPortal.sessions.create(payload);
    return json({ url: portal.url });
  } catch (e) {
    console.error("[billing-portal] error:", e);
    // Surface Stripe messages like “No configuration provided…” to help debug
    return json({ error: e?.message || "failed to create portal session" }, 500);
  }
};
