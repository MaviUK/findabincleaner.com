// netlify/functions/stripe-webhook.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

export const config = { path: "/.netlify/functions/stripe-webhook" };

export default async (req) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    const raw = await req.text();
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return new Response(JSON.stringify({ error: `Webhook signature verification failed` }), { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // You set these in sponsored-checkout.js using metadata
        const businessId = session.metadata?.business_id;
        const areaId = session.metadata?.area_id;

        // Pull subscription + first invoice details
        const subscriptionId = session.subscription;
        const customerId = session.customer;

        // Fetch subscription to get period dates and latest invoice
        const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
        const latestInv = sub.latest_invoice;

        // Upsert subscription row
        await supabase.from('sponsored_subscriptions').upsert({
          business_id: businessId,
          area_id: areaId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          price_monthly_pennies: sub.items.data[0].price.unit_amount, // integer pennies
          currency: sub.currency,
          status: sub.status, // 'active' etc
          current_period_end: new Date(sub.current_period_end * 1000).toISOString()
        }, { onConflict: 'stripe_subscription_id' });

        // Record the initial invoice if present
        if (latestInv && typeof latestInv === 'object') {
          const { data: subRow } = await supabase
            .from('sponsored_subscriptions')
            .select('id')
            .eq('stripe_subscription_id', subscriptionId)
            .single();

          await supabase.from('sponsored_invoices').upsert({
            sponsored_subscription_id: subRow.id,
            stripe_invoice_id: latestInv.id,
            hosted_invoice_url: latestInv.hosted_invoice_url,
            invoice_pdf: latestInv.invoice_pdf,
            amount_due_pennies: latestInv.amount_due,
            currency: latestInv.currency,
            status: latestInv.status,
            period_start: new Date(latestInv.period_start * 1000).toISOString(),
            period_end: new Date(latestInv.period_end * 1000).toISOString(),
          }, { onConflict: 'stripe_invoice_id' });
        }
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const inv = event.data.object;
        // Find subscription row
        const { data: subRow } = await supabase
          .from('sponsored_subscriptions')
          .select('id')
          .eq('stripe_subscription_id', inv.subscription)
          .single();

        if (subRow) {
          // Sync invoice record
          await supabase.from('sponsored_invoices').upsert({
            sponsored_subscription_id: subRow.id,
            stripe_invoice_id: inv.id,
            hosted_invoice_url: inv.hosted_invoice_url,
            invoice_pdf: inv.invoice_pdf,
            amount_due_pennies: inv.amount_due,
            currency: inv.currency,
            status: inv.status,
            period_start: new Date(inv.period_start * 1000).toISOString(),
            period_end: new Date(inv.period_end * 1000).toISOString(),
          }, { onConflict: 'stripe_invoice_id' });

          // Update sub status for dashboard (active, past_due, etc.)
          await supabase.from('sponsored_subscriptions')
            .update({ status: inv.status === 'paid' ? 'active' : 'past_due' })
            .eq('id', subRow.id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await supabase.from('sponsored_subscriptions')
          .update({ status: 'canceled' })
          .eq('stripe_subscription_id', sub.id);
        break;
      }

      default:
        // ignore other events
        break;
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
