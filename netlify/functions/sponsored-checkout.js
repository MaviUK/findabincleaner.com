// netlify/functions/sponsored-checkout.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing STRIPE_SECRET_KEY');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE // server-side key
);

// ---------- helpers ----------
function toPence(gbpNumber) {
  const n = Number(gbpNumber);
  return Math.round(Number.isFinite(n) ? n * 100 : 0);
}

function readNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  const trimmed = String(raw).trim().replace(/[,£_\s]/g, ''); // strip commas, £, underscores, spaces
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : fallback;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function siteBase() {
  const s = (process.env.PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/+$/, '');
  return s;
}

// ---------- handler ----------
export default async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const {
      cleanerId,
      areaId,
      slot,
      months = 1,
      drawnGeoJSON, // optional; if omitted we use the saved geometry
    } = await req.json();

    if (!cleanerId || !areaId || slot === undefined || slot === null) {
      return json({ error: 'cleanerId, areaId, slot required' }, 400);
    }

    const slotInt = Number(slot);
    const monthsInt = Math.max(1, Number(months) || 1);

    // 1) Recompute the preview on the server (always send all 4 args)
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: areaId,
      _slot: slotInt,
      _drawn_geojson: drawnGeoJSON ?? null,
      _exclude_cleaner: null, // explicit to disambiguate function overloads
    });

    if (error) {
      console.error('[checkout] get_area_preview error:', error);
      return json({ error: 'Failed to compute area/price' }, 500);
    }

    // get_area_preview returns a single row object
    const row = Array.isArray(data) ? data[0] : data;
    const area_km2 = Number(row?.area_km2 ?? 0);

    // 2) Pricing inputs from env (plain numbers only)
    const RATE = readNumberEnv('RATE_PER_KM2_PER_MONTH', NaN); // £/km²/month
    const MIN  = readNumberEnv('MIN_PRICE_PER_MONTH', NaN);    // £/month minimum

    const canPrice = Number.isFinite(RATE) && Number.isFinite(MIN) && Number.isFinite(area_km2);

    if (!canPrice) {
      // Helpful diagnostics while you’re configuring env vars / data
      return json(
        {
          error: 'Pricing unavailable (check env vars & area size)',
          debug: { area_km2, RATE, MIN },
        },
        400
      );
    }

    // Price calculation (always charge at least MIN)
    const monthly_price = Math.max(MIN, Math.max(0, area_km2) * RATE);
    const monthly_pennies = toPence(monthly_price);

    // 3) Build site URLs
    const site = siteBase();

    // 4) Decide billing mode
    //    monthsInt <= 1 => recurring subscription (recommended)
    //    monthsInt > 1  => one-off prepay (unit_amount × months)
    const billingMode = monthsInt > 1 ? 'payment' : 'subscription';

    // 5) Common metadata (send BOTH snake_case and camelCase)
    const commonMetadata = {
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

    // 6) Base session fields
    const baseSession = {
      success_url: `${site}/#/dashboard?checkout=success&checkout_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/#/dashboard?checkout=cancel`,
      metadata: commonMetadata,
      customer_creation: 'if_required',
    };

    let session;

    if (billingMode === 'subscription') {
      // Recurring monthly subscription
      session = await stripe.checkout.sessions.create({
        ...baseSession,
        mode: 'subscription',
        line_items: [
          {
            price_data: {
              currency: 'gbp',
              unit_amount: monthly_pennies,
              product_data: {
                name: `Sponsored Area – Slot ${slotInt}`,
                description: `Area: ${area_km2.toFixed(4)} km² • £${monthly_price.toFixed(2)}/month`,
                metadata: commonMetadata,
              },
              recurring: { interval: 'month' },
            },
            quantity: 1,
          },
        ],
      });
    } else {
      // One-off prepayment for N months
      const total_price = monthly_price * monthsInt;
      session = await stripe.checkout.sessions.create({
        ...baseSession,
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'gbp',
              unit_amount: monthly_pennies, // charge per month
              product_data: {
                name: `Sponsored Area – Slot ${slotInt} (Prepay ${monthsInt} mo)`,
                description: `Area: ${area_km2.toFixed(4)} km² • £${monthly_price.toFixed(2)}/month • Total £${total_price.toFixed(2)}`,
                metadata: commonMetadata,
              },
            },
            quantity: monthsInt, // Stripe multiplies unit_amount by this
          },
        ],
      });
    }

    return json({ url: session.url, id: session.id, mode: billingMode });
  } catch (e) {
    console.error('[checkout] error:', e);
    return json({ error: e?.message || 'checkout failed' }, 500);
  }
};
