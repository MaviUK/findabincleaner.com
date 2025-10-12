// netlify/functions/billing-portal.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { path: '/.netlify/functions/billing-portal' };

if (!process.env.STRIPE_SECRET_KEY) throw new Error('Missing STRIPE_SECRET_KEY');
if (!process.env.SUPABASE_URL) throw new Error('Missing SUPABASE_URL');
if (!process.env.SUPABASE_SERVICE_ROLE) throw new Error('Missing SUPABASE_SERVICE_ROLE');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function siteBase() {
  return (process.env.PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { cleanerId } = await req.json();
    if (!cleanerId) return json({ error: 'cleanerId required' }, 400);

    // 1) Try DB first for an existing customer id
    const { data: subRow } = await supabase
      .from('sponsored_subscriptions')
      .select('stripe_customer_id')
      .eq('business_id', cleanerId)
      .not('stripe_customer_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let stripeCustomerId = subRow?.stripe_customer_id || null;

    // 2) Fallback: look up the cleaner's email, then search Stripe customers by email
    if (!stripeCustomerId) {
      const { data: cleanerRow } = await supabase
        .from('cleaners')
        .select('user_id')
        .eq('id', cleanerId)
        .maybeSingle();

      const userId = cleanerRow?.user_id || null;
      let email = null;

      if (userId) {
        const { data: userRes } = await supabase.auth.admin.getUserById(userId);
        email = userRes?.user?.email || null;
      }

      if (email) {
        const results = await stripe.customers.search({
          query: `email:'${email.replace(/'/g, "\\'")}'`,
          limit: 1,
        });
        if (results?.data?.length) {
          stripeCustomerId = results.data[0].id;
        }
      }
    }

    if (!stripeCustomerId) {
      return json({ error: 'No customer found' }, 404);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: siteBase() + '/#/dashboard',
    });

    return json({ url: session.url });
  } catch (e) {
    console.error('[billing-portal] error', e);
    return json({ error: e?.message || 'Failed to create portal session' }, 500);
  }
};
