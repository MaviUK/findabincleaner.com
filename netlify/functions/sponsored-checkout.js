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
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const areaId = (body.areaId || "").trim();
  const businessId = (body.businessId || "").trim();
  const slot = Number(body.slot || 1);

  if (!areaId || !businessId) return json({ ok: false, error: "Missing params" }, 400);
  if (slot !== 1) return json({ ok: false, error: "Invalid slot" }, 400);

  try {
    // 1) Hard block if owned by another business
    const { data: takenRows, error: takenErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id, status")
      .eq("area_id", areaId)
      .eq("slot", slot)
      .order("created_at", { ascending: false })
      .limit(1);

    if (takenErr) return json({ ok: false, error: takenErr.message || "Ownership check failed" }, 500);

    const hasRow = Array.isArray(takenRows) && takenRows.length > 0;
    const row = hasRow ? takenRows[0] : null;
    const rowStatus = String(row?.status || "").toLowerCase();
    const ownedByOther = hasRow && BLOCKING.has(rowStatus) && row.business_id !== businessId;

    if (ownedByOther) {
      return json(
        {
          ok: false,
          error: "This featured slot is already owned by another business.",
          code: "SLOT_TAKEN",
        },
        409
      );
    }

    // 2) (Optional) Ensure there’s still purchasable geometry if you allow partials
    const { data: prevData, error: prevErr } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });
    if (prevErr) return json({ ok: false, error: prevErr.message || "Preview failed" }, 500);

    const km2 = Number((Array.isArray(prevData) ? prevData[0] : prevData)?.area_km2 ?? 0);
    if (!Number.isFinite(km2) || km2 <= 0) {
      return json({ ok: false, error: "No purchasable area available for this slot." }, 409);
    }

    // 3) Create your Stripe Checkout session (simplified)
    // Price is calculated client-side for display, but always recompute/validate server-side in production.
    const rate_per_km2 =
      Number(process.env.RATE_PER_KM2_PER_MONTH) ||
      Number(process.env.RATE_GOLD_PER_KM2_PER_MONTH) ||
      1;
    const floor_monthly =
      Number(process.env.MIN_PRICE_PER_MONTH) ||
      Number(process.env.MIN_GOLD_PRICE_PER_MONTH) ||
      1;

    const monthly = Math.max(km2 * rate_per_km2, floor_monthly);
    const unitAmount = Math.round(monthly * 100);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      success_url: `${process.env.PUBLIC_SITE_URL}/#dashboard?checkout=success`,
      cancel_url: `${process.env.PUBLIC_SITE_URL}/#dashboard?checkout=cancel`,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: "Featured Sponsorship",
              description: `Area ${areaId} — Featured slot`,
            },
            unit_amount: unitAmount,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      metadata: {
        area_id: areaId,
        business_id: businessId,
        slot: String(slot),
      },
    });

    return json({ ok: true, url: session.url });
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
