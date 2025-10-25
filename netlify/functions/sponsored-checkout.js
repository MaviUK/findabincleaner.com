// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/** Small JSON helper */
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ---------- Parse body ----------
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { businessId, areaId, slot } = body || {};
  if (!businessId || !areaId || !slot) return json({ error: "Missing params" }, 400);

  try {
    // ---------- 1) Hard block if another business already holds this slot ----------
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

    // ---------- 2) Reuse a provisional subscription row if we already have one ----------
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
      if (insErr || !inserted) {
        return json({ error: "Could not create a provisional subscription" }, 409);
      }
      subRowId = inserted.id;
    }

    // ---------- 3) Get preview to price the sub-region ----------
    // IMPORTANT: the preview function still expects keys: cleanerId, areaId, slot
    const pres = await fetch("/.netlify/functions/sponsored-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cleanerId: businessId, areaId, slot }),
    });

    if (!pres.ok) {
      const txt = await pres.text().catch(() => "");
      return json({ error: `Preview ${pres.status} ${txt || ""}`.trim() }, 502);
    }

    const preview = await pres.json();
    if (!preview?.ok) {
      return json({ error: preview?.error || "Preview failed" }, 502);
    }

    const monthly = Number(preview.monthly_price ?? 0);
    if (!Number.isFinite(monthly) || monthly <= 0) {
      return json({ error: "Invalid monthly price from preview" }, 500);
    }

    // Optional floor using env minimums, if you want
    const min = Number(process.env.MIN_PRICE_PER_MONTH ?? 0);
    const monthlyToBill = Math.max(monthly, Number.isFinite(min) ? min : 0);

    // ---------- 4) Create/find a Stripe Price for this monthly amount ----------
    // Simpler path: create an ad-hoc Price each time (fine for MVP)
    const product = await stripe.products.create({
      name: `Sponsor Slot #${slot} — Area ${areaId}`,
      metadata: { area_id: areaId, slot: String(slot) },
    });

    const price = await stripe.prices.create({
      unit_amount: Math.round(monthlyToBill * 100), // GBP in pence
      currency: "gbp",
      recurring: { interval: "month" },
      product: product.id,
      metadata: {
        area_id: areaId,
        slot: String(slot),
        sub_row_id: subRowId,
        monthly_from_preview: String(monthly),
      },
    });

    // ---------- 5) Create Checkout Session in subscription mode ----------
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
      metadata: {
        sub_row_id: subRowId,
        business_id: businessId,
        area_id: areaId,
        slot: String(slot),
      },
      success_url: `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=success`,
      cancel_url: `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=cancel`,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("[sponsored-checkout] error:", e);
    const msg =
      (e && typeof e === "object" && "message" in e && e.message) ||
      "Unhandled error";
    return json({ error: `Checkout 502 — ${msg}` }, 502);
  }
};
