// netlify/functions/cancel-sponsored-area.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

console.log("LOADED cancel-sponsored-area v2026-01-11");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function getSupabaseAdmin() {
  const url = requireEnv("SUPABASE_URL");
  const key =
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;

  if (!key) throw new Error("Missing Supabase service role key env var");
  return createClient(url, key, { auth: { persistSession: false } });
}

function getBearer(req) {
  const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function cancelAtPeriodEnd(stripeSubId) {
  // ✅ Cancel at period end (this is what your UI promises)
  return stripe.subscriptions.update(stripeSubId, {
    cancel_at_period_end: true,
  });
}

// (optional) keep an immediate cancel helper if you need it elsewhere
async function cancelStripeSubNow(stripeSubId) {
  if (stripe.subscriptions?.cancel) return stripe.subscriptions.cancel(stripeSubId);
  if (stripe.subscriptions?.del) return stripe.subscriptions.del(stripeSubId);
  // fallback: best-effort immediate cancellation isn't possible here
  return stripe.subscriptions.update(stripeSubId, { cancel_at_period_end: false });
}

export default async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true }, 200);
    if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

    requireEnv("STRIPE_SECRET_KEY");

    const body = await req.json().catch(() => null);
    if (!body) return json({ ok: false, error: "Invalid JSON" }, 400);

    const areaId = String(body.areaId || body.area_id || "").trim();
    const cleanerId = String(body.cleanerId || body.cleaner_id || body.businessId || body.business_id || "").trim();
    const slot = Number(body.slot ?? 1);

    if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
    if (!cleanerId) return json({ ok: false, error: "Missing cleanerId" }, 400);
    if (!Number.isFinite(slot) || slot !== 1) return json({ ok: false, error: "Invalid slot" }, 400);

    // ✅ IMPORTANT: require logged-in user (prevents anyone canceling others)
    const jwt = getBearer(req);
    if (!jwt) return json({ ok: false, error: "Missing Authorization bearer token" }, 401);

    const sb = getSupabaseAdmin();

    // Verify token is valid
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return json({ ok: false, error: "Invalid session" }, 401);
    }

    // ✅ Ownership check (recommended)
    // This assumes your `cleaners` table has a `user_id` column (auth user id).
    // If you don't have that, tell me and I’ll adapt it to your schema.
    const { data: cleanerRow, error: cleanerErr } = await sb
      .from("cleaners")
      .select("id, user_id")
      .eq("id", cleanerId)
      .maybeSingle();

    if (cleanerErr) throw cleanerErr;
    if (!cleanerRow) return json({ ok: false, error: "Cleaner not found" }, 404);

    if (cleanerRow.user_id && String(cleanerRow.user_id) !== String(userData.user.id)) {
      return json({ ok: false, error: "Not authorized for this business" }, 403);
    }

    // Find the latest active-ish row for this area+slot owned by this business
    const { data: subs, error: subErr } = await sb
      .from("sponsored_subscriptions")
      .select("id, business_id, status, stripe_subscription_id, stripe_customer_id")
      .eq("area_id", areaId)
      .eq("slot", slot)
      .order("created_at", { ascending: false });

    if (subErr) throw subErr;

    const row =
      (subs || []).find((r) => String(r.business_id) === String(cleanerId) && String(r.status).toLowerCase() === "active") ||
      (subs || []).find((r) => String(r.business_id) === String(cleanerId) && ["trialing", "past_due"].includes(String(r.status).toLowerCase())) ||
      null;

    if (!row || !row.stripe_subscription_id) {
      return json(
        { ok: false, error: "No active subscription found for this area." },
        404
      );
    }

    // 1) Cancel at Stripe immediately
    await stripe.subscriptions.update(row.stripe_subscription_id, {
  cancel_at_period_end: true,
});

    // 2) Update DB row so UI reacts instantly (webhook will also update)
    await sb
  .from("sponsored_subscriptions")
  .update({
    cancel_at_period_end: true,
    // keep status active until webhook updates it at end-of-period
    updated_at: new Date().toISOString(),
  })
  .eq("id", row.id);


    // 3) Delete the service area polygon
    // Use your existing RPC so all your constraints remain respected.
    const { error: delErr } = await sb.rpc("delete_service_area", {
      p_area_id: areaId,
    });
    if (delErr) throw delErr;

    return json({
      ok: true,
      canceled_subscription_id: row.stripe_subscription_id,
      deleted_area_id: areaId,
    });
  } catch (e) {
    console.error("[cancel-sponsored-area] error:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
