// netlify/functions/sponsored-checkout.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { cleanerId, areaId, slot, months = 1, drawnGeoJSON } = await req.json();

    if (!cleanerId || !areaId || !slot) {
      return new Response(JSON.stringify({ error: 'cleanerId, areaId, slot required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // TODO: compute a real amount from your DB / preview
    const unitAmountPence = 100; // £1.00 for test

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            unit_amount: unitAmountPence,
            product_data: { name: `Sponsorship #${slot} — ${areaId}` },
          },
          quantity: months,
        },
      ],
      metadata: { cleanerId, areaId, slot: String(slot), months: String(months) },
      success_url: `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=success`,
      cancel_url: `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=cancel`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'checkout failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
