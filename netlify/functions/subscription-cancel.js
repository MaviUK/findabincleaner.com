import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

console.log("LOADED sponsored-cancel v2026-01-04-CATEGORY-SAFE");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

export default async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const businessId = String(body?.businessId || body?.business_id || "").trim(); // cleaners.id
  const areaId = String(body?.areaId || body?.area_id || "").trim();
  const slot = Number(body?.slot ?? 1);
  const categoryId = String(body?.categoryId || body?.category_id || "").trim(); // ✅ required

  // optional but helpful (lets UI pass the exact subscription it wants to cancel)
  const stripeSubscriptionIdInput = String(
    body?.stripeSubscriptionId || body?.stripe_subscription_id || ""
  ).trim();

  console.log("[sponsored-cancel] payload:", {
    businessId,
    areaId,
    slot,
    categoryId,
    stripeSubscriptionIdInput: stripeSubscriptionIdInput || null,
  });

  if (!businessId || !areaId || !slot || !categoryId) {
    return json({ ok: false, error: "Missing params (businessId, areaId, slot, categoryId)" }, 400);
  }

  try {
    // 1) Find the correct row (industry-specific!)
    // Prefer the stripeSubscriptionId if provided, otherwise locate by (business, area, slot, category)
    let q = supabase
      .from("sponsored_subscriptions")
      .select("id, stripe_subscription_id, status")
      .eq("business_id", businessId)
      .eq("area_id", areaId)
      .eq("slot", slot)
      .eq("category_id", categoryId);

    if (stripeSubscriptionIdInput) {
      q = q.eq("stripe_subscription_id", stripeSubscriptionIdInput);
    }

    const { data: subRow, error: subErr } = await q.maybeSingle();

    if (subErr) {
      console.error("[sponsored-cancel] DB error:", subErr);
      return json({ ok: false, error: "DB error" }, 500);
    }

    if (!subRow?.stripe_subscription_id) {
      return json({ ok: false, error: "Subscription not found" }, 404);
    }

    // 2) Ask Stripe to cancel at period end
    // (You can switch to immediate cancel by using stripe.subscriptions.cancel(...) if you prefer)
    await stripe.subscriptions.update(subRow.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    // 3) Mirror locally WITHOUT freeing the area early
    // Best option: store a cancel_at_period_end flag.
    // If you don't have this column, you can set status="canceling" (but adding the flag is cleaner).
    const { error: updErr } = await supabase
      .from("sponsored_subscriptions")
      .update({
        cancel_at_period_end: true, // ✅ recommended column
        // status: "canceling",      // ✅ optional fallback if you don't add the column
      })
      .eq("id", subRow.id);

    if (updErr) {
      console.error("[sponsored-cancel] local mirror error:", updErr);
      // Stripe change succeeded; keep response ok but warn
      return json({ ok: true, warn: "Stripe updated; local status not updated" }, 200);
    }

    return json({ ok: true }, 200);
  } catch (e) {
    console.error("[sponsored-cancel] error:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
