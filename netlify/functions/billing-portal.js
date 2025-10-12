// netlify/functions/billing-portal.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { path: '/.netlify/functions/billing-portal' };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { cleanerId } = await req.json();
    if (!cleanerId) return json({ error: 'cleanerId required' }, 400);

    // find any subscription for this business to get their Stripe customer id
    const { data: sub, error } = await supabase
      .from('sponsored_subscriptions')
      .select('stripe_customer_id')
      .eq('business_id', cleanerId)
      .not('stripe_customer_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!sub?.stripe_customer_id) return json({ error: 'No customer found' }, 404);

    const returnUrl =
      (process.env.PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/+$/, '') +
      '/#/dashboard';

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: returnUrl,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error('[billing-portal] error', e);
    return json({ error: e?.message || 'Failed to create portal session' }, 500);
  }
};
