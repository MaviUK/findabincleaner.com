// netlify/functions/stripe-health.js
import Stripe from 'stripe';

export default async () => {
  try {
    const key = process.env.STRIPE_SECRET_KEY;

    if (!key) {
      return new Response(JSON.stringify({ ok: false, hasKey: false, reason: 'STRIPE_SECRET_KEY missing' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Mask the key for safety (never return secrets)
    const masked = key.startsWith('sk_') ? key.slice(0, 7) + '…' + key.slice(-4) : 'unexpected-format';

    // Try a very cheap authenticated call. If auth fails, the key is wrong.
    const stripe = new Stripe(key, { apiVersion: '2024-06-20' });
    try {
      const acct = await stripe.accounts.retrieve(); // works in Test & Live
      return new Response(
        JSON.stringify({
          ok: true,
          hasKey: true,
          keyLooksLike: masked,
          mode: key.includes('_test_') ? 'test' : 'live',
          stripeAccountType: acct?.type ?? 'unknown',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    } catch (authErr) {
      // Stripe responded but authentication failed → wrong/invalid key value
      return new Response(
        JSON.stringify({
          ok: false,
          hasKey: true,
          keyLooksLike: masked,
          reason: 'Stripe authentication failed (check the value & whitespace)',
          stripeError: authErr?.message ?? String(authErr),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || 'unknown error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
