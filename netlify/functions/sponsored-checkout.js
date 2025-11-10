// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

// ---- env / setup -----------------------------------------------------------
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || "http://localhost:8888";

// rate/min settings (major units, e.g., GBP)
const RATE_DEFAULT = Number(process.env.RATE_PER_KM2_PER_MONTH ?? 0);
const RATE_GOLD = Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? RATE_DEFAULT);

const MIN_DEFAULT = Number(process.env.MIN_PRICE_PER_MONTH ?? 0);
const MIN_GOLD = Number(process.env.MIN_GOLD_PRICE_PER_MONTH ?? MIN_DEFAULT);

// Blocking statuses = others can’t buy
const BLOCKING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const clamp2 = (n) => Math.max(0, Math.round(n * 100) / 100);

// ---- helper: compute price for Featured (slot 1) ---------------------------
function computeMonthlyMajor(availableKm2) {
  // Featured = “gold”
  const unit = Number.isFinite(RATE_GOLD) ? RATE_GOLD : 0;
  const floor = Number.isFinite(MIN_GOLD) ? MIN_GOLD : 0;
  const raw = (Number(availableKm2) || 0) * unit;
  return clamp2(Math.max(floor, raw));
}

// ---- main handler ----------------------------------------------------------
export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const businessId = (body.businessId || body.cleanerId || "").trim();
  const areaId = (body.areaId || "").trim();
  // single-slot model: Featured = slot 1
  const slot = 1;

  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);
  if (!areaId || !/^[0-9a-f-]{36}$/i.test(areaId)) {
    return json({ ok: false, error: "Missing or invalid areaId" }, 400);
  }

  try {
    // 1) Check if the slot is already taken by someone else (most recent, blocking)
    const { data: subs, error: subsErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id,status,created_at")
      .eq("area_id", areaId)
      .eq("slot", slot)
      .order("created_at", { ascending: false });

    if (subsErr) {
      return json({ ok: false, error: subsErr.message || "DB error (subs)" }, 500);
    }

    const takenRows = (subs || []).filter((r) =>
      BLOCKING.has(String(r.status || "").toLowerCase())
    );

    if (takenRows && takenRows.length > 0 && takenRows[0].business_id !== businessId) {
      return json(
        { ok: false, error: "This area is already sponsored by another business." },
        409
      );
    }

    // 2) Re-check remaining purchasable sub-geometry (server-side truth)
    const { data: preview, error: previewErr } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });

    if (previewErr) {
      return json({ ok: false, error: previewErr.message || "Preview query failed" }, 500);
    }

    const previewRow = Array.isArray(preview) ? preview[0] : preview;
    const availableKm2 = Number(previewRow?.area_km2 ?? 0) || 0;

    if (!(availableKm2 > 0)) {
      return json(
        { ok: false, error: "No purchasable area available for this slot." },
        409
      );
    }

    // 3) Compute price (in pence)
    const monthlyMajor = computeMonthlyMajor(availableKm2);
    const amountPence = Math.max(0, Math.round(monthlyMajor * 100));
    const currency = (previewRow?.unit_currency || "GBP").toLowerCase();

    // 4) Create Stripe Checkout (subscription, dynamic recurring price)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Create a dynamic recurring price
      line_items: [
        {
          price_data: {
            currency,
            recurring: { interval: "month" },
            product_data: {
              name: "Featured Sponsorship",
              description:
                "Your listing is featured first in search results for this service area.",
            },
            unit_amount: amountPence, // integer (pence)
          },
          quantity: 1,
        },
      ],
      // Have Stripe create a customer if one doesn’t exist
      customer_creation: "always",
      success_url: `${PUBLIC_SITE_URL}/#dashboard?checkout=success`,
      cancel_url: `${PUBLIC_SITE_URL}/#dashboard?checkout=cancel`,
      // Useful metadata for your webhook
      subscription_data: {
        metadata: {
          business_id: businessId,
          area_id: areaId,
          slot: String(slot),
          monthly_price_pence: String(amountPence),
          available_km2: String(availableKm2),
        },
      },
      metadata: {
        business_id: businessId,
        area_id: areaId,
        slot: String(slot),
        monthly_price_pence: String(amountPence),
        available_km2: String(availableKm2),
      },
    });

    return json({ ok: true, url: session.url }, 200);
  } catch (e) {
    console.error("[sponsored-checkout] fatal:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
