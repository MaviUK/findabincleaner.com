// netlify/functions/sponsored-checkout.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE // server-side key
);

function toPence(gbpNumber) {
  return Math.round(Number(gbpNumber) * 100);
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const {
      cleanerId,
      areaId,
      slot,
      months = 1,
      drawnGeoJSON, // optional if you want to force recompute from saved geometry
    } = await req.json();

    if (!cleanerId || !areaId || !slot) {
      return new Response(JSON.stringify({ error: 'cleanerId, areaId, slot required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // 1) Recompute the preview on the server
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: areaId,
      _slot: slot,
      _drawn_geojson: drawnGeoJSON ?? null, // pass null if you want function to use stored geometry
    });

    if (error) {
      console.error('[checkout] get_area_preview error:', error);
      return new Response(JSON.stringify({ error: 'Failed to compute area/price' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    const area_km2 = Number(data?.area_km2 ?? 0);

    // 2) Pricing (env-configurable)
    const RATE = Number(process.env.RATE_PER_KM2_PER_MONTH || 15); // £/km²/month
    const MIN  = Number(process.env.MIN_PRICE_PER_MONTH || 1);     // £/month minimum

    const monthly_price = Math.max(MIN, area_km2 * RATE);
    const total_price   = monthly_price * Number(months);

    // convert to pence for Stripe
    const unit_amount = toPence(monthly_price);

    // 3) Build URLs from env
    const site = process.env.PUBLIC_SITE_URL?.replace(/\/+$/, '') || 'http://localhost:5173';

    // 4) Create Stripe checkout
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            unit_amount, // pence
            product_data: {
              name: `Area sponsorship #${slot}`,
              description: `Area: ${area_km2.toFixed(4)} km²  •  £${monthly_price.toFixed(2)}/month`,
            },
          },
          quantity: Number(months),
        },
      ],
      metadata: {
        cleanerId,
        areaId,
        slot: String(slot),
        months: String(months),
        area_km2: String(area_km2),
        monthly_price: monthly_price.toFixed(2),
        total_price: total_price.toFixed(2),
      },
      success_url: `${site}/#/dashboard?checkout=success`,
      cancel_url:  `${site}/#/dashboard?checkout=cancel`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    console.error('[checkout] error:', e);
    return new Response(JSON.stringify({ error: e.message || 'checkout failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
