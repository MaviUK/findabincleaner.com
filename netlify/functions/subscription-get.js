import { createClient } from "@supabase/supabase-js";

export default async (req) => {
  try {
    const url = new URL(req.url);
    const business_id = url.searchParams.get("business_id");
    const area_id = url.searchParams.get("area_id");
    const slot = Number(url.searchParams.get("slot") || "0");

    if (!business_id || !area_id || !slot) {
      return new Response(JSON.stringify({ error: "Missing params" }), { status: 400 });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

    const { data, error } = await supabase
      .from("sponsored_subscriptions")
      .select(`
        id, status, current_period_end, stripe_subscription_id, stripe_customer_id,
        price_monthly_pennies, currency
      `)
      .eq("business_id", business_id)
      .eq("area_id", area_id)
      .eq("slot", slot)
      .maybeSingle();

    if (error) throw error;

    // Optionally include latest invoice link
    let invoice = null;
    if (data?.id) {
      const { data: inv } = await supabase
        .from("sponsored_invoices")
        .select("hosted_invoice_url, invoice_pdf, status, amount_due_pennies, period_end")
        .eq("sponsored_subscription_id", data.id)
        .order("period_end", { ascending: false })
        .limit(1)
        .maybeSingle();
      invoice = inv ?? null;
    }

    return new Response(JSON.stringify({ ok: true, subscription: data, invoice }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || "Server error" }), { status: 500 });
  }
};
