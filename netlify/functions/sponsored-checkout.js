// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ---- Parse body
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const { businessId, areaId, slot } = body || {};
  if (!businessId || !areaId || !slot) return json({ error: "Missing params" }, 400);

  // ---- 1) Ensure slot is not taken by someone else
  // "blocking" = statuses that mean another business effectively owns the slot
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

  // ---- 2) Reuse any provisional for this business/area/slot
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
    // ---- 3) Create fresh provisional row
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
    if (insErr || !inserted)
      return json({ error: "Could not create a provisional subscription" }, 409);
    subRowId = inserted.id;
  }

  // ---- 4) Get authoritative monthly price from your preview function
  // This guarantees checkout matches the UI and respects clipping/availability.
  try {
    const previewUrl = `${process.env.PUBLIC_SITE_URL}/.netlify/functions/sponsored-preview`;
    const pres = await fetch(previewUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId, areaId, slot }),
    });

    if (!pres.ok) {
      const txt = await pres.text().catch(() => "");
      return json({ error: `Preview ${pres.status}${txt ? ` – ${txt}` : ""}` }, 502);
    }

    const pjson = await pres.json();
    if (!pjson?.ok) {
      return json({ error: pjson?.error || "Failed to compute preview" }, 502);
    }

    const monthlyGBP = Number(pjson.monthly_price);
    if (!Number.isFinite(monthlyGBP) || monthlyGBP <= 0) {
      return json({ error: "Invalid monthly price" }, 400);
    }

    const amountPence = Math.round(monthlyGBP * 100);

    // Optional: nicer product name
    const productName = `Sponsor #${slot} — Area ${areaId} (${pjson.area_km2?.toFixed?.(4) ?? "?"} km²)`;

    // ---- 5) Create Stripe Checkout Session (SUBSCRIPTION)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "gbp",
            unit_amount: amountPence,          // integer, pence
            recurring: { interval: "month" },  // **required** for subscriptions
            product_data: { name: productName },
          },
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
    console.error("[sponsored-checkout] error creating checkout:", e);
    return json(
      {
        error:
          "Checkout 502 – could not create Subscription. Ensure preview and Stripe are reachable, and that a recurring line item is supplied.",
      },
      502
    );
  }
};
