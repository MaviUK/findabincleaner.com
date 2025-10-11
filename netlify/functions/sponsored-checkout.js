// netlify/functions/sponsored-checkout.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

function toPence(gbpNumber) {
  return Math.round(Number(gbpNumber) * 100);
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { 'content-type': 'text/plain' } });
  }

  try {
    const { cleanerId, areaId, slot, months = 1, drawnGeoJSON } = await req.json();

    if (!cleanerId || !areaId || !slot) {
      return new Response(JSON.stringify({ error: 'cleanerId, areaId, slot required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // 1) Recompute preview on the server (4-arg signature)
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: areaId,
      _slot: Number(slot),
      _drawn_geojson: drawnGeoJSON ?? null,
      _exclude_cleaner: null, // <-- IMPORTANT: match current SQL signature
    });
    if (error) {
      console.error('[checkout] get_area_preview error:', error);
      return new Response(JSON.stringify({ error: 'Failed to compute area/price' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    const area_km2 = Number(data?.area_km2 ?? 0);

    // 2) Pricing from env (with sane fallbacks)
    const RATE = Number(process.env.RATE_PER_KM2_PER_MONTH ?? 15);
    const MIN  = Number(process.env.MIN_PRICE_PER_MONTH ?? 1);

    const canPrice = Number.isFinite(area_km2) && area_km2 > 0 && Number.isFinite(RATE) && Number.isFinite(MIN);
    if (!canPrice) {
      return new Response(JSON.stringify({ error: 'Pricing unavailable (check env vars & area size)' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const monthly_price = Math.max(MIN, area_km2 * RATE);
    const total_price   = monthly_price * Math.max(1, Number(months));

    // 3) Build URLs from env
    const site = (process.env.PUBLIC_SITE_URL || '').replace(/\/+$/, '') || 'http://localhost:5173';

    // 4) Create checkout
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            unit_amount: toPence(monthly_price), // pence
            product_data: {
              name: `Area sponsorship #${slot}`,
              description: `Area: ${area_km2.toFixed(4)} km²  •  £${monthly_price.toFixed(2)}/month`,
            },
          },
          quantity: Math.max(1, Number(months)),
        },
      ],
      metadata: {
        cleanerId,
        areaId,
        slot: String(slot),
        months: String(months),
        area_km2: area_km2.toFixed(6),
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
