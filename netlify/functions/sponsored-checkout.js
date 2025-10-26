// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const businessId = body.businessId || body.cleanerId;
  const areaId = body.areaId || body.area_id;
  const slot = Number(body.slot);
  const previewUrl = body.previewUrl || body.preview_url;

  if (!businessId || !areaId || !slot) return json({ error: "Missing params" }, 400);
  if (!previewUrl) return json({ error: "Valid previewUrl required" }, 400);

  // extract previewId from previewUrl
  let previewId = null;
  try {
    const u = new URL(previewUrl);
    previewId = u.searchParams.get("previewId");
  } catch { /* ignore */ }
  if (!previewId) return json({ error: "Valid previewUrl required" }, 400);

  // 1) Load cached preview + validate
  const { data: prev, error: prevErr } = await sb
    .from("sponsored_preview_cache")
    .select("*")
    .eq("id", previewId)
    .single();

  if (prevErr || !prev) return json({ error: "Preview not found/expired" }, 400);
  if (prev.business_id !== businessId || prev.area_id !== areaId || Number(prev.slot) !== slot) {
    return json({ error: "Preview does not match request" }, 400);
  }
  if (new Date(prev.expires_at).getTime() < Date.now()) {
    return json({ error: "Preview expired. Please try again." }, 400);
  }
  if (!Number.isFinite(prev.area_km2) || prev.area_km2 <= 0) {
    return json({ error: "No purchasable area left." }, 409);
  }

  // 2) Hard block if someone else holds the slot (active-ish)
  const BLOCKING = ["active", "trialing", "past_due", "unpaid"];
  const { data: conflicts, error: conflictErr } = await sb
    .from("sponsored_subscriptions")
    .select("id,business_id,status")
    .eq("area_id", areaId)
    .eq("slot", slot)
    .in("status", BLOCKING)
    .neq("business_id", businessId)
    .limit(1);

  if (conflictErr) return json({ error: "DB error (conflict)" }, 500);
  if (conflicts?.length) return json({ error: "Slot already taken" }, 409);

  // 3) Reuse or create provisional db row
  const PROVISIONAL = ["incomplete", "incomplete_expired"];
  const { data: existing } = await sb
    .from("sponsored_subscriptions")
    .select("id,status")
    .eq("business_id", businessId)
    .eq("area_id", areaId)
    .eq("slot", slot)
    .in("status", PROVISIONAL)
    .order("created_at", { ascending: false })
    .limit(1);

  let subRowId;
  if (existing?.[0]) {
    subRowId = existing[0].id;
  } else {
    const { data: inserted, error: insErr } = await sb
      .from("sponsored_subscriptions")
      .insert({
        business_id: businessId,
        area_id: areaId,
        slot,
        status: "incomplete",
      })
      .select("id")
      .single();
    if (insErr || !inserted) return json({ error: "Could not create a provisional subscription" }, 409);
    subRowId = inserted.id;
  }

  // 4) Stripe Checkout (subscription). We use the cached monthly_price_cents
  const unitAmount = Math.max(0, Number(prev.monthly_price_cents) || 0);
  if (!unitAmount) return json({ error: "Invalid price" }, 400);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price_data: {
          currency: "gbp",
          product_data: {
            name: `Sponsor Slot #${slot} — Area ${areaId}`,
            description: "Cleanly Marketplace Sponsored Area",
          },
          unit_amount: unitAmount,
          recurring: { interval: "month" },
        },
        quantity: 1,
      },
    ],
    // carry identifiers to webhook
    metadata: {
      sub_row_id: subRowId,
      business_id: businessId,
      area_id: areaId,
      slot: String(slot),
      preview_id: previewId,
    },
    success_url: `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=success`,
    cancel_url: `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=cancel`,
  });

  return json({ url: session.url });
};
