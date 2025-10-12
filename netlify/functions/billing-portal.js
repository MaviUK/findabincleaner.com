// netlify/functions/billing-portal.js
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

function siteBase() {
  return (process.env.PUBLIC_SITE_URL || "http://localhost:5173").replace(/\/+$/, "");
}

/**
 * Input (POST JSON):
 * {
 *   "cleanerId": "<uuid>",              // required
 *   "email": "<optional email>"         // optional, helps when no row yet
 * }
 */
export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const { cleanerId, email } = await req.json();

    if (!cleanerId) {
      return json({ error: "cleanerId required" }, 400);
    }

    // 1) Try to get an existing stripe_customer_id from your DB
    let stripeCustomerId = null;

    // Try sponsored_subscriptions (any row for this business_id)
    {
      const { data, error } = await supabase
        .from("sponsored_subscriptions")
        .select("stripe_customer_id")
        .eq("business_id", cleanerId)
        .not("stripe_customer_id", "is", null)
        .limit(1);

      if (!error && data && data.length && data[0].stripe_customer_id) {
        stripeCustomerId = data[0].stripe_customer_id;
      }
    }

    // If not found, try cleaners table (if you store it there)
    if (!stripeCustomerId) {
      const { data: cleanerRow } = await supabase
        .from("cleaners")
        .select("stripe_customer_id, business_name, address, user_id")
        .eq("id", cleanerId)
        .maybeSingle();

      if (cleanerRow?.stripe_customer_id) {
        stripeCustomerId = cleanerRow.stripe_customer_id;
      }

      // 2) If still not found, try to find by email in Stripe, or create a new Customer
      if (!stripeCustomerId) {
        // Resolve an email: prefer provided, else from profiles (if you have it)
        let resolvedEmail = email || null;
        if (!resolvedEmail && cleanerRow?.user_id) {
          // if you use Supabase auth profiles
          const { data: profile } = await supabase
            .from("profiles")
            .select("email")
            .eq("id", cleanerRow.user_id)
            .maybeSingle();
          if (profile?.email) resolvedEmail = profile.email;
        }

        // a) try to find by email
        if (resolvedEmail) {
          const list = await stripe.customers.list({ email: resolvedEmail, limit: 1 });
          if (list.data.length) {
            stripeCustomerId = list.data[0].id;
          }
        }

        // b) create if still missing
        if (!stripeCustomerId) {
          const created = await stripe.customers.create({
            email: resolvedEmail || undefined,
            name: cleanerRow?.business_name || undefined,
            address: undefined, // you can fill from cleanerRow.address if you store a structured object
            metadata: { cleaner_id: cleanerId },
          });
          stripeCustomerId = created.id;
        }

        // Persist the new customer id to cleaners table for future lookups (best effort)
        if (stripeCustomerId && (!cleanerRow || cleanerRow.stripe_customer_id !== stripeCustomerId)) {
          await supabase
            .from("cleaners")
            .update({ stripe_customer_id: stripeCustomerId })
            .eq("id", cleanerId);
        }
      }
    }

    if (!stripeCustomerId) {
      // As a last guard—shouldn’t happen now that we create one
      return json({ error: "No customer found" }, 404);
    }

    // 3) Create a Stripe Billing Portal session
    const portal = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${siteBase()}/#/dashboard`,
    });

    return json({ url: portal.url });
  } catch (e) {
    console.error("[billing-portal] error:", e);
    return json({ error: e?.message || "failed to create portal session" }, 500);
  }
};
