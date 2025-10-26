// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function getBaseUrl(req) {
  const envUrl =
    process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  const host = req?.headers?.get?.("host");
  return (host ? `https://${host}` : "").replace(/\/$/, "");
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { businessId, areaId, slot } = body || {};
  if (!businessId || !areaId || !slot) return json({ error: "Missing params" }, 400);

  try {
    // 1) Same-area hard conflict (active-ish)
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

    // 2) Reuse/create provisional row
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
        .insert({ business_id: businessId, area_id: areaId, slot, status: "incomplete" })
        .select("id")
        .single();
      if (insErr || !inserted) return json({ error: "Could not create a provisional subscription" }, 409);
      subRowId = inserted.id;
    }

    // 3) Preview (absolute URL) — this accounts for overlaps across OTHER areas
    const base = getBaseUrl(req);
    if (!base) return json({ error: "Cannot resolve site base URL for preview" }, 500);

    const previewURL = `${base}/.netlify/functions/sponsored-preview`;
    const pres = await fetch(previewURL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cleanerId: businessId, areaId, slot }),
    });

    if (!pres.ok) {
      const txt = await pres.text().catch(() => "");
      return json({ error: `Preview ${pres.status} ${txt || ""}`.trim() }, 502);
    }
    const preview = await pres.json();
    if (!preview?.ok) return json({ error: preview?.error || "Preview failed" }, 409);

    // >>> NEW: if overlapping sponsors leave zero purchasable area, stop here
    const areaKm2 = Number(preview.area_km2 ?? 0);
    if (!Number.isFinite(areaKm2) || areaKm2 <= 0) {
      return json({ error: "No purchasable area for this slot (overlaps fully taken)" }, 409);
    }

    // Price from preview (with optional floor)
    const monthly = Number(preview.monthly_price ?? 0);
    if (!Number.isFinite(monthly) || monthly <= 0)
      return json({ error: "Invalid monthly price from preview" }, 500);
    const min = Number(process.env.MIN_PRICE_PER_MONTH ?? 0);
    const monthlyToBill = Math.max(monthly, Number.isFinite(min) ? min : 0);

    // 4) Create ad-hoc Product + Price
    const product = await stripe.products.create({
      name: `Sponsor Slot #${slot} — Area ${areaId}`,
      metadata: { area_id: areaId, slot: String(slot), sub_row_id: subRowId },
    });

    const price = await stripe.prices.create({
      unit_amount: Math.round(monthlyToBill * 100),
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

    // 5) Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { sub_row_id: subRowId, business_id: businessId, area_id: areaId, slot: String(slot) },
      success_url: `${base}/#/dashboard?checkout=success`,
      cancel_url: `${base}/#/dashboard?checkout=cancel`,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("[sponsored-checkout] error:", e);
    return json({ error: `Checkout 502 — ${(e && e.message) || "Unhandled error"}` }, 502);
  }
};
