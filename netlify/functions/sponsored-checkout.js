import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const BLOCKING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);
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

  const businessId = (body.businessId || body.cleanerId || "").trim();
  const areaId = (body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot || 1);

  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);
  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (![1].includes(slot)) {
    return json({ ok: false, error: "Invalid slot" }, 400);
  }

  try {
    // 1) Hard block: is this featured slot owned by ANYONE?
    const { data: takenRows, error: takenErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id, status")
      .eq("area_id", areaId)
      .eq("slot", slot);

    if (takenErr) throw takenErr;

    const blocking = (takenRows || []).filter((r) =>
      BLOCKING.has(String(r.status || "").toLowerCase())
    );

    if (blocking.length > 0) {
      const ownerId = String(blocking[0].business_id || "");
      const ownedByMe = ownerId && ownerId === businessId;

      return json(
        {
          ok: false,
          code: ownedByMe ? "already_subscribed" : "slot_taken",
          message: "No purchasable area left for this slot.",
        },
        409
      );
    }

    // 2) Pull remaining area from our preview RPC
    const { data: previewRow, error: prevErr } = await sb.rpc(
      "area_remaining_preview",
      {
        p_area_id: areaId,
        p_slot: slot,
      }
    );
    if (prevErr) throw prevErr;

    const row = Array.isArray(previewRow)
      ? previewRow[0] || {}
      : previewRow || {};

    const rawAvailable =
      row.available_km2 ?? row.area_km2 ?? row.remaining_km2 ?? 0;

    let available_km2 = Number(rawAvailable);
    if (!Number.isFinite(available_km2)) available_km2 = 0;
    available_km2 = Math.max(0, available_km2);

    if (available_km2 <= EPS) {
      return json(
        {
          ok: false,
          code: "no_remaining",
          message: "No purchasable area left for this slot.",
        },
        409
      );
    }

    // 3) Price (rate * available_km2)
    const rate_per_km2 =
      Number(
        process.env.RATE_GOLD_PER_KM2_PER_MONTH ??
          process.env.RATE_PER_KM2_PER_MONTH ??
          0
      ) || 0;

    const amount_cents = Math.max(
      1,
      Math.round(available_km2 * rate_per_km2 * 100)
    );

    // 4) Get (or create) the Stripe customer for this cleaner
    const { data: biz, error: bizErr } = await sb
      .from("cleaners")
      .select("stripe_customer_id")
      .eq("id", businessId)
      .maybeSingle();

    if (bizErr) throw bizErr;

    let stripeCustomerId = biz?.stripe_customer_id || null;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({});
      stripeCustomerId = customer.id;

      await sb
        .from("cleaners")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", businessId);
    }

    // helper to build checkout session
    const createSession = (customerId) =>
      stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        metadata: {
          business_id: businessId,
          area_id: areaId,
          slot: String(slot),
        },
        line_items: [
          {
            price_data: {
              currency: "gbp",
              product_data: {
                name: "Featured service area",
                description:
                  "Be shown first in local search results for this area.",
              },
              unit_amount: amount_cents,
              recurring: { interval: "month" },
            },
            quantity: 1,
          },
        ],
        success_url: `${process.env.PUBLIC_SITE_URL}/#dashboard?checkout=success`,
        cancel_url: `${process.env.PUBLIC_SITE_URL}/#dashboard?checkout=cancel`,
      });

    let session;
    try {
      session = await createSession(stripeCustomerId);
    } catch (e) {
      // If the stored Stripe customer is stale, recreate and retry once
      const code = e?.raw?.code;
      const param = e?.raw?.param;
      if (code === "resource_missing" && param === "customer") {
        const customer = await stripe.customers.create({});
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
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
