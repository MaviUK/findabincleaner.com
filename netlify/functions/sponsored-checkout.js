// netlify/functions/sponsored-checkout.js
const { createClient } = require("@supabase/supabase-js");
const Stripe = require("stripe");

/**
 * Helper to read a numeric env var (defaults to 0 if missing/invalid)
 */
function readIntEnv(name, defaultValue) {
  const raw = process.env[name];
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : defaultValue;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: "Method Not Allowed",
      };
    }

    const payload = JSON.parse(event.body || "{}");
    const businessId = payload.businessId;
    const areaId = payload.areaId;
    const slotRaw = payload.slot;

    if (!businessId || !areaId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          ok: false,
          error: "Missing businessId or areaId",
        }),
      };
    }

    // Slots are 1-based in the DB. Default to 1 if not provided.
    const slot =
      Number.isFinite(Number(slotRaw)) && Number(slotRaw) > 0
        ? Number(slotRaw)
        : 1;

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // 1. Ask DB how much area is left for this area+slot
    const { data: previewData, error: previewError } = await supabase.rpc(
      "area_remaining_preview",
      {
        p_area_id: areaId,
        p_slot: slot,
      }
    );

    if (previewError) {
      console.error("area_remaining_preview error", previewError);
      return {
        statusCode: 500,
        body: JSON.stringify({
          ok: false,
          error: `Failed to calculate remaining area: ${previewError.message}`,
        }),
      };
    }

    const previewRow =
      (Array.isArray(previewData) ? previewData[0] : previewData) || null;

    if (!previewRow) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          ok: false,
          error: "No preview data returned for this area",
        }),
      };
    }

    const totalKm2 = Number(previewRow.total_km2) || 0;
    const availableKm2 = Math.max(
      0,
      Number(previewRow.available_km2) || 0
    );
    const soldOut = Boolean(previewRow.sold_out);
    const reason = previewRow.reason || "unknown";

    // If nothing is purchasable, block checkout
    if (soldOut || availableKm2 <= 0) {
      return {
        statusCode: 409, // Conflict
        body: JSON.stringify({
          ok: false,
          error: "No purchasable area for this slot",
          reason,
          totalKm2,
          availableKm2,
        }),
      };
    }

    // 2. Compute price.
    //    We use env vars so it matches your existing rate/floor logic.
    //    - RATE_PER_KM2_PER_MONTH: pennies per km² per month (e.g. 100 = £1)
    //    - MIN_PRICE_PER_MONTH: floor monthly price in pennies
    const ratePerKm2Pennies = readIntEnv("RATE_PER_KM2_PER_MONTH", 100); // default £1
    const minPricePerMonthPennies = readIntEnv("MIN_PRICE_PER_MONTH", 100); // default £1

    const rawMonthlyPennies = Math.round(availableKm2 * ratePerKm2Pennies);
    const monthlyPricePennies = Math.max(
      minPricePerMonthPennies,
      rawMonthlyPennies
    );

    const currency = "gbp";

    // 3. Create a provisional sponsored_subscriptions row
    const { data: insertData, error: insertError } = await supabase
      .from("sponsored_subscriptions")
      .insert({
        business_id: businessId,
        area_id: areaId,
        slot,
        status: "incomplete",
        price_monthly_pennies: monthlyPricePennies,
        currency,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert sponsored_subscriptions error", insertError);
      return {
        statusCode: 500,
        body: JSON.stringify({
          ok: false,
          error: `Failed to create provisional subscription: ${insertError.message}`,
        }),
      };
    }

    const subscriptionId = insertData.id;

    // 4. Stripe Checkout session
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) {
      console.error("Missing STRIPE_SECRET_KEY env var");
      return {
        statusCode: 500,
        body: JSON.stringify({
          ok: false,
          error: "Stripe secret key is not configured",
        }),
      };
    }

    const stripe = new Stripe(stripeSecret, { apiVersion: "2024-06-20" });

    const publicSiteUrl = process.env.PUBLIC_SITE_URL || "https://findabincleaner.com";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      success_url: `${publicSiteUrl}/#/dashboard?checkout=success`,
      cancel_url: `${publicSiteUrl}/#/dashboard?checkout=cancel`,
      line_items: [
        {
          price_data: {
            currency,
            recurring: {
              interval: "month",
            },
            unit_amount: monthlyPricePennies,
            product_data: {
              name: `Featured sponsorship for area`,
              description: `Area ID ${areaId}, slot ${slot}`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        sponsored_subscription_id: subscriptionId,
        area_id: areaId,
        business_id: businessId,
        slot: String(slot),
      },
    });

    // Save the session ID so webhooks/post-verify can tie things together
    const { error: updateError } = await supabase
      .from("sponsored_subscriptions")
      .update({
        stripe_checkout_session_id: session.id,
      })
      .eq("id", subscriptionId);

    if (updateError) {
      console.error("Update sponsored_subscriptions error", updateError);
      // Don't fail the checkout just because we couldn't persist the session id;
      // but do log it.
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        url: session.url,
        subscriptionId,
        totalKm2,
        availableKm2,
        monthlyPricePennies,
      }),
    };
  } catch (err) {
    console.error("sponsored-checkout handler error", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: err.message || "Unknown error",
      }),
    };
  }
};
