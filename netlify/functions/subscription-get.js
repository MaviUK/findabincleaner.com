// netlify/functions/subscription-get.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY
);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async (req) => {
  try {
    if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const businessId = body?.businessId ?? null; // cleaners.id
    const areaId = body?.areaId ?? null;
    const slot = parseInt(body?.slot, 10);

    console.log("[subscription-get] payload:", { businessId, areaId, slot });

    if (!businessId || !areaId || ![1, 2, 3].includes(slot)) {
      return json({ ok: false, error: "Missing params" }, 400);
    }

    // DB row
    const { data: subRow, error: subErr } = await supabase
      .from("sponsored_subscriptions")
      .select(
        "id, business_id, area_id, slot, status, price_monthly_pennies, current_period_end, stripe_subscription_id"
      )
      .eq("business_id", businessId)
      .eq("area_id", areaId)
      .eq("slot", slot)
      .maybeSingle();

    if (subErr) {
      console.error("[subscription-get] DB error (subs):", subErr);
      return json({ ok: false, error: "DB error" }, 500);
    }

    if (!subRow) return json({ ok: false, notFound: true }, 200);

    // Area name (optional)
    let areaName = null;
    const { data: areaRow } = await supabase
      .from("service_areas")
      .select("name")
      .eq("id", areaId)
      .maybeSingle();
    areaName = areaRow?.name ?? null;

    // Stripe truth (if available)
    let stripeCancelAtPeriodEnd = null;
    let stripePeriodEndIso = subRow.current_period_end ?? null;

    if (subRow.stripe_subscription_id) {
      try {
        const s = await stripe.subscriptions.retrieve(subRow.stripe_subscription_id);
        stripeCancelAtPeriodEnd = Boolean(s.cancel_at_period_end);
        stripePeriodEndIso = s.current_period_end
          ? new Date(s.current_period_end * 1000).toISOString()
          : stripePeriodEndIso;
      } catch (e) {
        console.warn("[subscription-get] Stripe retrieve failed:", e?.message || e);
      }
    }

    return json({
      ok: true,
      subscription: {
        area_name: areaName,
        status: subRow.status ?? null,
        current_period_end: stripePeriodEndIso,
        price_monthly_pennies:
          typeof subRow.price_monthly_pennies === "number" ? subRow.price_monthly_pennies : null,
        cancel_at_period_end: stripeCancelAtPeriodEnd,
      },
    });
  } catch (e) {
    console.error("[subscription-get] Uncaught error:", e);
    return json({ ok: false, error: "Server error" }, 500);
  }
};
