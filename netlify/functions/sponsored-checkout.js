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
  const { businessId, areaId, slot } = body || {};
  if (!businessId || !areaId || !slot) return json({ error: "Missing params" }, 400);

  // 1) Is this slot held by someone else (active-ish)?
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

  // 2) Reuse an existing provisional for this business/area/slot if present
  const PROVISIONAL = ["incomplete", "incomplete_expired"];
  const { data: existing, error: existErr } = await sb
    .from("sponsored_subscriptions")
    .select("id,status")
    .eq("business_id", businessId)
    .eq("area_id", areaId)
    .eq("slot", slot)
    .in("status", PROVISIONAL)
    .order("created_at", { ascending: false })
    .limit(1);

  if (existErr) return json({ error: "DB error (lookup provisional)" }, 500);

  let subRowId;
  if (existing?.[0]) {
    subRowId = existing[0].id; // reuse it
  } else {
    // 3) Otherwise create a fresh provisional row
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

  // 4) Create Stripe Checkout Session (example — adapt your pricing/lookups)
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    // ... your line items built from pricing & preview results ...
    metadata: { sub_row_id: subRowId, business_id: businessId, area_id: areaId, slot: String(slot) },
    success_url: `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=success`,
    cancel_url: `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=cancel`,
  });

  return json({ url: session.url });
};
