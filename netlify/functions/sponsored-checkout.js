// netlify/functions/sponsored-checkout.js
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { areaId, businessId, geom, areaName, totalArea, pricePerKm, monthlyPrice } = body;

    console.log('Checkout request:', { areaId, businessId, areaName, monthlyPrice });

    // Validate required fields
    if (!areaId || !businessId || !monthlyPrice) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          error: 'Missing required fields: areaId, businessId, or monthlyPrice' 
        }),
      };
    }

    // Get cleaner/business details from database
    const { data: cleaner, error: cleanerError } = await supabase
      .from('cleaners')
      .select('stripe_customer_id, email, business_name, user_id')
      .eq('id', businessId)
      .single();

    if (cleanerError) {
      console.error('Error fetching cleaner:', cleanerError);
      throw new Error('Failed to fetch business details');
    }

    if (!cleaner) {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ error: 'Business not found' }),
      };
    }

    // Ensure customer has a Stripe customer ID
    let customerId = cleaner.stripe_customer_id;
    
    if (!customerId) {
      console.log('Creating Stripe customer for:', cleaner.business_name);
      const customer = await stripe.customers.create({
        email: cleaner.email,
        name: cleaner.business_name,
        metadata: {
          cleaner_id: businessId,
          user_id: cleaner.user_id,
        },
      });
      customerId = customer.id;

      // Update cleaner with new customer ID
      await supabase
        .from('cleaners')
        .update({ stripe_customer_id: customerId })
        .eq('id', businessId);
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: {
            name: `Sponsored Area - ${areaName || areaId}`,
            description: 'Featured placement in local search results. Your business appears first to customers in this area.',
            metadata: {
              area_id: areaId,
              area_name: areaName || '',
            },
          },
          unit_amount: Math.round(monthlyPrice * 100), // Convert £ to pence
          recurring: {
            interval: 'month',
          },
        },
        quantity: 1,
      }],
      success_url: `${process.env.URL || 'http://localhost:5173'}/dashboard?checkout=success&area_id=${areaId}`,
      cancel_url: `${process.env.URL || 'http://localhost:5173'}/dashboard?checkout=cancel`,
      metadata: {
        area_id: areaId,
        business_id: businessId,
        area_name: areaName || '',
        total_area: totalArea ? totalArea.toString() : '',
        price_per_km: pricePerKm ? pricePerKm.toString() : '',
        geom: geom || '',
      },
      subscription_data: {
        metadata: {
          area_id: areaId,
          business_id: businessId,
          area_name: areaName || '',
        },
      },
    });

    console.log('Checkout session created:', session.id);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        url: session.url,
        sessionId: session.id,
      }),
    };

  } catch (error) {
    console.error('Checkout error:', error);
    
    return {
      statusCode: 502,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        error: 'Checkout failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      }),
    };
  }
};
