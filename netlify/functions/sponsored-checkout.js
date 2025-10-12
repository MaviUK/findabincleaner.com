// netlify/functions/sponsored-checkout.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Service-role client (server only)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

// ---------- helpers ----------
function toPence(gbpNumber) {
  const n = Number(gbpNumber);
  return Math.round(Number.isFinite(n) ? n * 100 : 0);
}

function readNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : fallback;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function siteBase() {
  return (process.env.PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

// Best-effort guard: don’t allow duplicate purchases for same business/area/slot
async function hasExistingSponsorship(business_id, area_id, slot) {
  try {
    const { data, error } = await supabase
      .from('sponsored_subscriptions')
      .select('id,status,stripe_subscription_id,stripe_payment_intent_id')
      .eq('business_id', business_id)
      .eq('area_id', area_id)
      .eq('slot', Number(slot))
      .limit(1);

    if (error) return false;
    if (!data || !data.length) return false;

    const row = data[0];
    const activeStatuses = new Set([
      'active',
      'trialing',
      'past_due',
      'unpaid',
      'incomplete',
      'incomplete_expired',
    ]);

    // Consider either: an active-ish subscription OR a prepay record present
    return (
      (row.status && activeStatuses.has(row.status)) ||
      Boolean(row.stripe_payment_intent_id)
    );
  } catch {
    // If the table/view doesn’t exist yet, don’t block purchase
    return false;
  }
}

// ---------- handler ----------
export default async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const {
      cleanerId,        // business_id (uuid)
      areaId,           // area_id (uuid)
      slot,             // 1|2|3
      months = 1,       // integer
      drawnGeoJSON,     // optional; if omitted we use saved geometry
      buyerEmail,       // optional: prefill customer email
    } = await req.json();

    if (!cleanerId || !areaId || !slot) {
      return json({ error: 'cleanerId, areaId, slot required' }, 400);
    }

    // 0) Prevent duplicates (best-effort)
    const already = await hasExistingSponsorship(cleanerId, areaId, slot);
    if (already) {
      return json(
        { error: 'You already have an active/prepaid sponsorship for this slot.' },
        409
      );
    }

    // 1) Recompute the preview on the server (always pass all 4 args)
    const { data, error } = await supabase.rpc('get_area_preview', {
      _area_id: areaId,
      _slot: Number(slot),
      _drawn_geojson: drawnGeoJSON ?? null,
      _exclude_cleaner: null, // explicit to disambiguate function overloads
    });

    if (error) {
      console.error('[checkout] get_area_preview error:', error);
      return json({ error: 'Failed to compute area/price' }, 500);
    }

    // get_area_preview returns a single row object
    const area_km2 = Number((Array.isArray(data) ? data[0]?.area_km2 : data?.area_km2) ?? 0);

    // 2) Pricing inputs from env (plain numbers only)
    const RATE = readNumberEnv('RATE_PER_KM2_PER_MONTH', 15); // £/km²/month
    const MIN  = readNumberEnv('MIN_PRICE_PER_MONTH', 1);     // £/month minimum

    // Decide if we can price
    const canPrice = Number.isFinite(RATE) && Number.isFinite(MIN) && Number.isFinite(area_km2);
    if (!canPrice) {
      return json(
        {
          error: 'Pricing unavailable (check env vars & area size)',
          debug: { area_km2, RATE, MIN },
        },
        400
      );
    }

    // Price calculation (always charge at least MIN)
    const monthsInt = Math.max(1, Number(months));
    const monthly_price = Math.max(MIN, Math.max(0, area_km2) * RATE);
    const total_price   = monthly_price * monthsInt;

    // Convert to pence for Stripe
    const unit_amount = toPence(monthly_price);

    // 3) Build site URLs
    const site = siteBase();

    // 4) Create Stripe Checkout session (PAYMENT MODE) and **create/attach Customer**
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',

      // ✅ Ensures a Customer exists in payment mode
      customer_creation: { enabled: true },
      customer_update: { name: 'auto', address: 'auto' },
      // Optional prefill (helps reduce friction + match by email later)
      customer_email: buyerEmail || undefined,

      line_items: [
        {
          price_data: {
            currency: 'gbp',
            unit_amount, // pence
            product_data: {
              name: `Area sponsorship #${slot}`,
              description: `Area: ${area_km2.toFixed(4)} km² • £${monthly_price.toFixed(2)}/month`,
            },
          },
          quantity: monthsInt, // total = unit_amount * quantity
        },
      ],

      // Use snake_case so webhooks/postverify can read easily
      metadata: {
        cleaner_id: cleanerId,
        area_id: areaId,
        slot: String(slot),
        months: String(monthsInt),
        area_km2: area_km2.toFixed(6),
        monthly_price_pennies: String(unit_amount), // handy for postverify
        total_price_pennies: String(unit_amount * monthsInt),
      },

      // Include checkout_session placeholder so the dashboard can post-verify
      success_url: `${site}/#/dashboard?checkout=success&checkout_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/#/dashboard?checkout=cancel`,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error('[checkout] error:', e);
    return json({ error: e?.message || 'checkout failed' }, 500);
  }
};
