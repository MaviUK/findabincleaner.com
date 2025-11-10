// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

const BLOCKING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const businessId = (body.businessId || body.cleanerId || "").trim();
  const areaId = (body.areaId || "").trim();
  const slot = Number(body.slot ?? 1);
  const preview_km2 = typeof body.preview_km2 === "number" ? body.preview_km2 : null;

  if (!businessId || !areaId) return json({ error: "Missing businessId/areaId" }, 400);

  try {
    // Server-side lock: if anything blocking exists, refuse
    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("status, business_id")
      .eq("area_id", areaId)
      .eq("slot", slot);

    if (subsErr) throw subsErr;

    const blocker = (subs || []).find((r) => BLOCKING.has(String(r.status || "").toLowerCase()));
    if (blocker && blocker.business_id !== businessId) {
      return json({ error: "This slot is already taken." }, 409);
    }

    // (Your normal Stripe session build goes here – unchanged)
    const pricePerKmMonth = Number(process.env.RATE_PER_KM2_PER_MONTH ?? 0);
    const amountMajor = Math.max(
      Number(process.env.MIN_PRICE_PER_MONTH ?? 0),
      (preview_km2 ?? 0) * pricePerKmMonth
    );
    const amountCents = Math.round(amountMajor * 100);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: { name: "Featured Sponsorship" },
            recurring: { interval: "month" },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.PUBLIC_SITE_URL}/#dashboard?checkout=success`,
      cancel_url: `${process.env.PUBLIC_SITE_URL}/#dashboard?checkout=cancel`,
      metadata: { area_id: areaId, business_id: businessId, slot: String(slot) },
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("sponsored-checkout error:", e);
    return json({ error: e?.message || "Server error" }, 500);
  }
};
