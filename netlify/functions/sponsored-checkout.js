import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error("[sponsored-checkout] Missing Supabase env vars");
}
if (!STRIPE_SECRET_KEY) {
  console.error("[sponsored-checkout] Missing STRIPE_SECRET_KEY");
}
if (!PUBLIC_SITE_URL) {
  console.error("[sponsored-checkout] Missing PUBLIC_SITE_URL");
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// small epsilon so we treat tiny leftovers as zero
const EPS = 1e-6;

export default async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const businessId = String(body.businessId || body.cleanerId || "").trim();
  const areaId = String(body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot || 1);

  // ✅ NEW: categoryId for per-industry sponsorship
  const categoryIdRaw = body.categoryId ?? body.category_id ?? null;
  const categoryId = categoryIdRaw ? String(categoryIdRaw).trim() : null;

  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);
  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (!categoryId) return json({ ok: false, error: "Missing categoryId" }, 400);

  if (![1].includes(slot)) {
    return json({ ok: false, error: "Invalid slot" }, 400);
  }

  try {
    // 1) Recompute remaining area for this service area + category + slot
    const { data: previewData, error: prevErr } = await sb
  .from("sponsored_locks")
  .update({ is_active: false })
  .eq("is_active", true)
  .lt("expires_at", new Date().toISOString());

    if (prevErr) throw prevErr;

    const row = Array.isArray(previewData) ? previewData[0] || {} : previewData || {};

    let available_km2 = Number(row.available_km2 ?? 0) || 0;
    const sold_out_flag = Boolean(row.sold_out);

    if (!Number.isFinite(available_km2)) available_km2 = 0;

    if (sold_out_flag || available_km2 <= EPS) {
      return json(
        {
          ok: false,
          code: "no_remaining",
          message: "No purchasable area left for this slot.",
        },
        409
      );
    }

    // 2) Pricing
    const rate_per_km2 =
      Number(
        process.env.RATE_GOLD_PER_KM2_PER_MONTH ??
          process.env.RATE_PER_KM2_PER_MONTH ??
          0
      ) || 0;

    const amount_cents = Math.max(
      1,
      Math.round(Math.max(available_km2, 0) * rate_per_km2 * 100)
    );

    // 3) Load cleaner and ensure Stripe customer
    const { data: cleaner, error: cleanerErr } = await sb
      .from("cleaners")
      .select("id, stripe_customer_id, business_name, email")
      .eq("id", businessId)
      .maybeSingle();

    if (cleanerErr) throw cleanerErr;
    if (!cleaner) return json({ ok: false, error: "Cleaner not found" }, 404);

    let stripeCustomerId = cleaner.stripe_customer_id || null;
    const customerName = cleaner.business_name || "Customer";

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        name: customerName,
        email: cleaner.email || undefined,
      });
      stripeCustomerId = customer.id;

      await sb
        .from("cleaners")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", businessId);
    }

    const createSession = (customerId) =>
      stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        metadata: {
          business_id: businessId,
          area_id: areaId,
          slot: String(slot),
          category_id: categoryId, // ✅ NEW
        },
        line_items: [
          {
            price_data: {
              currency: "gbp",
              product_data: {
                name: "Featured service area",
                description: "Be shown first in local search results for this area.",
              },
              unit_amount: amount_cents,
              recurring: { interval: "month" },
            },
            quantity: 1,
          },
        ],
        success_url: `${PUBLIC_SITE_URL}/#dashboard?checkout=success`,
        cancel_url: `${PUBLIC_SITE_URL}/#dashboard?checkout=cancel`,
      });

    let session;
    try {
      session = await createSession(stripeCustomerId);
    } catch (e) {
      // if stored customer is stale, recreate and retry once
      const code = e?.raw?.code;
      const param = e?.raw?.param;

      if (code === "resource_missing" && param === "customer") {
        const customer = await stripe.customers.create({
          name: customerName,
          email: cleaner.email || undefined,
        });

        stripeCustomerId = customer.id;

        await sb
          .from("cleaners")
          .update({ stripe_customer_id: stripeCustomerId })
          .eq("id", businessId);

        session = await createSession(stripeCustomerId);
      } else {
        throw e;
      }
    }

    return json({ ok: true, url: session.url }, 200);
  } catch (e) {
    console.error("[sponsored-checkout] error:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
