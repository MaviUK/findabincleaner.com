// netlify/functions/sponsored-checkout.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

if (!process.env.STRIPE_SECRET_KEY) throw new Error('Missing STRIPE_SECRET_KEY');
if (!process.env.SUPABASE_URL) throw new Error('Missing SUPABASE_URL');
if (!process.env.SUPABASE_SERVICE_ROLE) throw new Error('Missing SUPABASE_SERVICE_ROLE');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

// ---------- helpers ----------
function toPence(gbpNumber) {
  const n = Number(gbpNumber);
  return Math.round(Number.isFinite(n) ? n * 100 : 0);
}
function readNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  const trimmed = String(raw).trim().replace(/[,£_\s]/g, ''); // strip commas/£/spaces
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : fallback;
}
function siteBase() {
  return (process.env.PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/+$/, '');
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ---------- handler ----------
export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const {
      cleanerId,   // business_id
      areaId,
      slot,
      months = 1,
      drawnGeoJSON, // optional; null uses saved geometry
    } = await req.json();

    if (!cleanerId || !areaId || slot === undefined || slot === null) {
      return json({ error: 'cleanerId, areaId, slot required' }, 400);
    }

    const slotInt = Number(slot);
    const monthsInt = Math.max(1, Number(months) || 1);

    // 0) SERVER GUARD — prevent duplicate purchase of same (business, area, slot)
    try {
      const { data: existing } = await supabase
        .from('sponsored_subscriptions')
        .select('id,status')
        .eq('business_id', cleanerId)
        .eq('area_id', areaId)
        .eq('slot', slotInt)
        .in('status', ['active','trialing','past_due','unpaid','incomplete','incomplete_expired'])
        .limit(1)
        .maybeSingle();

      if (existing) {
        return json(
          { error: 'You already have this sponsorship.', code: 'ALREADY_OWN', details: existing },
          409
        );
      }
    } catch (preErr) {
      // non-fatal; continue but log
      console.warn('[checkout] duplicate preflight failed:', preErr);
    }

    // 1) Recompute area/price via RPC (authoritative)
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: areaId,
      _slot: slotInt,
      _drawn_geojson: drawnGeoJSON ?? null,
      _exclude_cleaner: null, // explicit to disambiguate overloads
    });
    if (error) {
      console.error('[checkout] get_area_preview error:', error);
      return json({ error: 'Failed to compute area/price' }, 500);
    }
    const row = Array.isArray(data) ? data[0] : data;
    const area_km2 = Number(row?.area_km2 ?? 0);

    // 2) Pricing from env
    const RATE = readNumberEnv('RATE_PER_KM2_PER_MONTH', NaN); // £/km²/month
    const MIN  = readNumberEnv('MIN_PRICE_PER_MONTH', NaN);    // £/month minimum
    if (!(Number.isFinite(RATE) && Number.isFinite(MIN) && Number.isFinite(area_km2))) {
      return json(
        { error: 'Pricing unavailable (check env vars & area size)', debug: { area_km2, RATE, MIN } },
        400
      );
    }

    const monthly_price = Math.max(MIN, Math.max(0, area_km2) * RATE);
    const monthly_pennies = Math.max(1, toPence(monthly_price)); // Stripe requires >= 1

    // 3) URLs + common metadata (send BOTH snake_case & camelCase)
    const site = siteBase();
    const metadata = {
      cleaner_id: String(cleanerId),
      area_id: String(areaId),
      slot: String(slotInt),
      cleanerId: String(cleanerId),
      areaId: String(areaId),
      months: String(monthsInt),
      area_km2: area_km2.toFixed(6),
      monthly_price: monthly_price.toFixed(2),
      monthly_price_pennies: String(monthly_pennies),
      rate_per_km2_per_month: String(RATE),
      min_price_per_month: String(MIN),
    };

    // 4) Choose mode
    const isSubscription = monthsInt <= 1;
    let session;

    if (isSubscription) {
      // Recurring monthly subscription (auto-renews)
      session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        success_url: `${site}/#/dashboard?checkout=success&checkout_session={CHECKOUT_SESSION_ID}`,
        cancel_url: `${site}/#/dashboard?checkout=cancel`,
        metadata,
        line_items: [
          {
            price_data: {
              currency: 'gbp',
              unit_amount: monthly_pennies,
              recurring: { interval: 'month' },
              product_data: {
                name: `Sponsored Area – Slot ${slotInt}`,
                description: `Area: ${area_km2.toFixed(4)} km² • £${monthly_price.toFixed(2)}/month`,
                metadata,
              },
            },
            quantity: 1,
          },
        ],
      });
    } else {
      // One-off prepayment for N months (no renewal)
      const total_price = monthly_price * monthsInt;
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        success_url: `${site}/#/dashboard?checkout=success&checkout_session={CHECKOUT_SESSION_ID}`,
        cancel_url: `${site}/#/dashboard?checkout=cancel`,
        metadata,
        customer_creation: 'if_required', // only allowed in payment mode
        line_items: [
          {
            price_data: {
              currency: 'gbp',
              unit_amount: monthly_pennies, // per-month price
              product_data: {
                name: `Sponsored Area – Slot ${slotInt} (Prepay ${monthsInt} mo)`,
                description: `Area: ${area_km2.toFixed(4)} km² • £${monthly_price.toFixed(2)}/month • Total £${total_price.toFixed(2)}`,
                metadata,
              },
            },
            quantity: monthsInt, // Stripe multiplies unit_amount by this
          },
        ],
      });
    }

    return json({ url: session.url, id: session.id, mode: isSubscription ? 'subscription' : 'payment' });
  } catch (e) {
    console.error('[checkout] error:', e);
    return json({ error: e?.message || 'checkout failed' }, 500);
  }
};
