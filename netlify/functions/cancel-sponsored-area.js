// netlify/functions/cancel-sponsored-area.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

console.log("LOADED cancel-sponsored-area v2026-01-23");

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
  const h =
    req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function normalizeStatus(s) {
  return String(s || "").trim().toLowerCase();
}

/**
 * Pick the "best" subscription row for cancellation:
 * 1) status=active
 * 2) status=trialing
 * 3) status=past_due
 * 4) otherwise newest (already ordered desc)
 */
function pickBestRow(subs, cleanerId) {
  const mine = (subs || []).filter(
    (r) => String(r.business_id) === String(cleanerId)
  );

  const byStatus = (st) => mine.find((r) => normalizeStatus(r.status) === st);

  return (
    byStatus("active") ||
    byStatus("trialing") ||
    byStatus("past_due") ||
    mine[0] ||
    null
  );
}

/**
 * Stripe-safe cancel_at_period_end:
 * - If already canceled, DO NOTHING (prevents Stripe error)
 * - If already set to cancel at period end, DO NOTHING
 * - Else set cancel_at_period_end = true
 */
async function cancelAtPeriodEndSafe(stripeSubId) {
  const sub = await stripe.subscriptions.retrieve(stripeSubId);

  if (!sub) return { skipped: true, sub: null };

  if (sub.status === "canceled") return { skipped: true, sub };
  if (sub.cancel_at_period_end) return { skipped: true, sub };

  const updated = await stripe.subscriptions.update(stripeSubId, {
    cancel_at_period_end: true,
  });

  return { skipped: false, sub: updated };
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
    if (req.method !== "POST")
      return json({ ok: false, error: "Method not allowed" }, 405);

    requireEnv("STRIPE_SECRET_KEY");

    const body = await req.json().catch(() => null);
    if (!body) return json({ ok: false, error: "Invalid JSON" }, 400);

    const areaId = String(body.areaId || body.area_id || "").trim();
    const cleanerId = String(
      body.cleanerId ||
        body.cleaner_id ||
        body.businessId ||
        body.business_id ||
        ""
    ).trim();
    const slot = Number(body.slot ?? 1);

    if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
    if (!cleanerId) return json({ ok: false, error: "Missing cleanerId" }, 400);
    if (!Number.isFinite(slot) || slot !== 1)
      return json({ ok: false, error: "Invalid slot" }, 400);

    // ✅ require logged-in user
    const jwt = getBearer(req);
    if (!jwt)
      return json(
        { ok: false, error: "Missing Authorization bearer token" },
        401
      );

    const sb = getSupabaseAdmin();

    // Verify token is valid
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return json({ ok: false, error: "Invalid session" }, 401);
    }

    // Ownership check
    const { data: cleanerRow, error: cleanerErr } = await sb
      .from("cleaners")
      .select("id, user_id")
      .eq("id", cleanerId)
      .maybeSingle();

    if (cleanerErr) throw cleanerErr;
    if (!cleanerRow) return json({ ok: false, error: "Cleaner not found" }, 404);

    if (
      cleanerRow.user_id &&
      String(cleanerRow.user_id) !== String(userData.user.id)
    ) {
      return json({ ok: false, error: "Not authorized for this business" }, 403);
    }

    // Pull all rows for area+slot (newest first), then choose best for this cleaner
    const { data: subs, error: subErr } = await sb
      .from("sponsored_subscriptions")
      .select(
        "id, business_id, status, stripe_subscription_id, stripe_customer_id, cancel_at_period_end"
      )
      .eq("area_id", areaId)
      .eq("slot", slot)
      .order("created_at", { ascending: false });

    if (subErr) throw subErr;

    const row = pickBestRow(subs, cleanerId);

    if (!row || !row.stripe_subscription_id) {
      return json(
        { ok: false, error: "No subscription found for this area." },
        404
      );
    }

    // 1) Stripe: cancel at period end (safe/idempotent)
    const stripeRes = await cancelAtPeriodEndSafe(row.stripe_subscription_id);

    // 2) DB: mark cancel_at_period_end immediately so UI updates
    // Also: if Stripe says it's canceled already, reflect that status to avoid future confusion.
    const newStatus = stripeRes?.sub?.status ? String(stripeRes.sub.status) : null;

    const { error: updErr } = await sb
      .from("sponsored_subscriptions")
      .update({
        cancel_at_period_end: true,
        ...(newStatus ? { status: newStatus } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (updErr) throw updErr;

    // 2b) OPTIONAL: If there are duplicate rows for this same area+slot+business,
    // mark older "incomplete" rows as canceled too (keeps UI/rules clean).
    // This won’t delete history; it just prevents the “wrong row” being picked later.
    const dupes = (subs || []).filter(
      (r) =>
        String(r.business_id) === String(cleanerId) &&
        String(r.id) !== String(row.id)
    );

    const incompleteDupeIds = dupes
      .filter((r) => normalizeStatus(r.status) === "incomplete")
      .map((r) => r.id);

    if (incompleteDupeIds.length) {
      await sb
        .from("sponsored_subscriptions")
        .update({
          status: "canceled",
          cancel_at_period_end: true,
          updated_at: new Date().toISOString(),
        })
        .in("id", incompleteDupeIds);
      // ignore errors here; it's best-effort cleanup
    }

    // 3) Delete the service area polygon (requires fixed RPC signature uuid,uuid)
    const { error: delErr } = await sb.rpc("delete_service_area", {
      p_area_id: areaId,
      p_cleaner_id: cleanerId,
    });

    if (delErr) throw delErr;

    return json({
      ok: true,
      canceled_subscription_id: row.stripe_subscription_id,
      stripe_skipped: !!stripeRes?.skipped,
      stripe_status: stripeRes?.sub?.status || null,
      deleted_area_id: areaId,
      cleaned_incomplete_duplicates: incompleteDupeIds.length,
    });
  } catch (e) {
    console.error("[cancel-sponsored-area] error:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
