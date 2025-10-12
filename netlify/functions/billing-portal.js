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

    // 1) Try DB first — any existing sponsorship row with a customer id
    const { data: subRow, error: subErr } = await supabase
      .from('sponsored_subscriptions')
      .select('stripe_customer_id')
      .eq('business_id', cleanerId)
      .not('stripe_customer_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let stripeCustomerId = subRow?.stripe_customer_id || null;
    if (subErr) console.warn('[billing-portal] sub lookup error', subErr);

    // 2) If not found, fall back to searching Stripe by the cleaner's email
    if (!stripeCustomerId) {
      // get user_id for this cleaner
      const { data: cleanerRow, error: cleanerErr } = await supabase
        .from('cleaners')
        .select('user_id')
        .eq('id', cleanerId)
        .maybeSingle();
      if (cleanerErr) console.warn('[billing-portal] cleaner lookup error', cleanerErr);

      const userId = cleanerRow?.user_id || null;
      let email = null;

      if (userId) {
        // Service role key can query auth users
        const { data: userRes, error: userErr } = await supabase.auth.admin.getUserById(userId);
        if (userErr) console.warn('[billing-portal] auth user lookup error', userErr);
        email = userRes?.user?.email || null;
      }

      if (email) {
        try {
          // Search customers in Stripe by email (works in test & live)
          const results = await stripe.customers.search({
            query: `email:'${email.replace(/'/g, "\\'")}'`,
            limit: 1,
          });
          if (results?.data?.length) {
            stripeCustomerId = results.data[0].id;
          }
        } catch (e) {
          console.warn('[billing-portal] stripe search error', e);
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
