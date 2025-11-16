import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { businessId, areaId, monthlyPrice } = body;

    if (!businessId || !areaId || !monthlyPrice) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing parameters" }),
      };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    //
    // 1. Load the business (now stored in `profiles`, not `businesses`)
    //
    const { data: business, error: businessErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", businessId)
      .single();

    if (businessErr || !business) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Business profile not found",
          details: businessErr?.message
        }),
      };
