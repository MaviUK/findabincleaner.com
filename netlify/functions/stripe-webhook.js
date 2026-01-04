// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

console.log("LOADED stripe-webhook v2026-01-04-GEOM-EWKT-MULTI+OVERLAP-GRACE");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// statuses that should be treated as "blocking/owned"
const BLOCKING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

function isBlockingStatus(s) {
  return BLOCKING.has(String(s || "").toLowerCase());
}

function safeLower(x) {
  return String(x || "").toLowerCase();
}

async function releaseLockSafe(lockId) {
  if (!lockId) return;
  try {
    await sb.from("sponsored_locks").update({ is_active: false }).eq("id", lockId);
  } catch (e) {
    console.warn("[webhook] failed to release lock:", lockId, e?.message || e);
  }
}

/**
 * ✅ IMPORTANT: fetch the service area geometry and return EWKT MultiPolygon in 4326.
 * This prevents "has no geometry" and prevents Polygon vs MultiPolygon mismatch.
 *
 * Assumes: service_areas.geom exists (PostGIS geometry)
 */
async function getAreaSponsoredGeomEWKT(areaId) {
  if (!areaId) return null;

  // Use a PostgREST computed select via PostGIS SQL in a view? Not needed:
  // Supabase supports "select" but not raw SQL expressions.
  // So we call an RPC that returns EWKT if you already have one.
  //
  // If you DON'T have an RPC yet, simplest is to add it (SQL below).
  //
  // We'll attempt RPC first:
  const { data, error } = await sb.rpc("get_service_area_geom_ewkt", { p_area_id: areaId });

  if (!error) {
    // function may return { ewkt: 'SRID=4326;MULTIPOLYGON(...)' } or plain text
    if (typeof data === "string") return data;
    if (Array.isArray(data) && data[0]?.ewkt) return data[0].ewkt;
    if (data?.ewkt) return data.ewkt;
  }

  // If RPC doesn't exist, we can't reliably compute EWKT from JS without coordinates.
  // Return null so we fail loudly with a clear message.
  console.error(
    "[webhook] Missing RPC get_service_area_geom_ewkt() or it errored:",
    error?.message || error
  );
  return null;
}

function extractMeta(obj) {
  const meta = obj?.metadata || {};
  const business_id =
    meta.business_id || meta.cleaner_id || meta.cleanerId || meta.businessId || null;
  const area_id = meta.area_id || meta.areaId || null;
  const category_id = meta.category_id || meta.categoryId || null;
  const slot = Number(meta.slot || 1);
  const lock_id = meta.lock_id || null;
  return { business_id, area_id, category_id, slot, lock_id };
}

async function upsertSubscription({ business_id, area_id, category_id, slot, stripe_customer_id, stripe_subscription_id, status, price_monthly_pennies, currency, current_period_end, lock_id }) {
  // ✅ Fetch EWKT MultiPolygon 4326 and write it directly into sponsored_geom
  const ewkt = await getAreaSponsoredGeomEWKT(area_id);

  if (!ewkt) {
    // This is what was causing your "has no geometry" (trigger fires and throws).
    // We log and release lock, but return gracefully.
    console.warn("[webhook] no area geometry EWKT available; releasing lock", {
      business_id, area_id, category_id, slot, stripe_subscription_id,
    });
    await releaseLockSafe(lock_id);
    return { ok: false, reason: "no_geometry" };
  }

  const payload = {
    business_id,
    area_id,
    category_id,
    slot,
    stripe_customer_id,
    stripe_subscription_id,
    price_monthly_pennies: price_monthly_pennies ?? null,
    currency: (currency || "gbp")?.toLowerCase(),
    status: status || "active",
    current_period_end: current_period_end || null,

    // ✅ the critical field:
    sponsored_geom: ewkt, // EWKT string -> PostGIS geometry column
  };

  const { error } = await sb
    .from("sponsored_subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  if (!error) {
    // release lock if present
    await releaseLockSafe(lock_id);
    return { ok: true };
  }

  // ✅ Overlap-grace: if DB blocks because overlap rule, do NOT crash webhook
  const msg = String(error?.message || "");
  const code = String(error?.code || "");

  const isOverlap =
    code === "23505" || // uniqueness / raised errors sometimes surface as this
    msg.includes("overlap") ||
    msg.includes("conflict=");

  const isGeomTypeMismatch =
    code === "22023" || msg.includes("does not match column type");

  const isNoGeom =
    code === "P0001" && msg.includes("has no geometry");

  if (isOverlap) {
    console.warn("[webhook] overlap prevented DB write; lock will be released.", {
      business_id, area_id, category_id, slot, stripe_subscription_id,
    });
    await releaseLockSafe(lock_id);
    return { ok: false, reason: "overlap" };
  }

  if (isGeomTypeMismatch) {
    console.error("[webhook] geom type mismatch even after EWKT multi:", error);
    await releaseLockSafe(lock_id);
    return { ok: false, reason: "geom_type_mismatch" };
  }

  if (isNoGeom) {
    console.error("[webhook] still no geometry after EWKT fetch:", error);
    await releaseLockSafe(lock_id);
    return { ok: false, reason: "no_geometry" };
  }

  console.error("[stripe-webhook] DB upsert failed:", error);
  await releaseLockSafe(lock_id);
  throw new Error("DB write(sponsored_subscriptions) failed");
}

export default async (req) => {
  if (req.method === "GET") {
    return json({ ok: true, note: "stripe-webhook deployed. Stripe calls POST." });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const sig = req.headers.get("stripe-signature");
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !endpointSecret) {
    return json({ ok: false, error: "Missing stripe signature or webhook secret" }, 400);
  }

  let event;
  try {
    const rawBody = await req.text();
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (e) {
    console.error("[webhook] signature verify failed:", e?.message || e);
    return json({ ok: false, error: "Signature verification failed" }, 400);
  }

  try {
    const t = event.type;
    const obj = event.data?.object;

    // ---- checkout.session.completed ----
    if (t === "checkout.session.completed") {
      console.log("[webhook] checkout.session.completed id=" + event.id);

      const session = obj;
      const meta = extractMeta(session);

      // Need subscription & customer
      const subId = session?.subscription || null;
      const custId = session?.customer || null;

      if (!meta.business_id || !meta.area_id || !meta.category_id || !subId || !custId) {
        await releaseLockSafe(meta.lock_id);
        return json({
          ok: true,
          skipped: true,
          reason: "missing_metadata",
          got: { ...meta, subId, custId },
        });
      }

      // Fetch subscription for period end & status
      const sub = await stripe.subscriptions.retrieve(String(subId));
      const currentPeriodEndIso = sub?.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;

      // Use session amount if available
      const pricePennies =
        session?.amount_total ?? session?.amount_subtotal ?? null;

      const currency = session?.currency || "gbp";

      // Upsert
      await upsertSubscription({
        business_id: meta.business_id,
        area_id: meta.area_id,
        category_id: meta.category_id,
        slot: meta.slot || 1,
        stripe_customer_id: String(custId),
        stripe_subscription_id: String(subId),
        status: safeLower(sub?.status || "active"),
        price_monthly_pennies: pricePennies,
        currency,
        current_period_end: currentPeriodEndIso,
        lock_id: meta.lock_id,
      });

      return json({ ok: true });
    }

    // ---- customer.subscription.created/updated/deleted ----
    if (
      t === "customer.subscription.created" ||
      t === "customer.subscription.updated" ||
      t === "customer.subscription.deleted"
    ) {
      console.log(`[webhook] ${t} id=${event.id}`);

      const sub = obj;
      const meta = extractMeta(sub);

      const subId = sub?.id || null;
      const custId = sub?.customer || null;

      if (!meta.business_id || !meta.area_id || !meta.category_id || !subId || !custId) {
        await releaseLockSafe(meta.lock_id);
        return json({
          ok: true,
          skipped: true,
          reason: "missing_metadata",
          got: { ...meta, subId, custId },
        });
      }

      const currentPeriodEndIso = sub?.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;

      const status = safeLower(sub?.status || "active");

      // price: grab from items[0].price.unit_amount if expanded (may not be)
      let pricePennies = null;
      try {
        pricePennies =
          sub?.items?.data?.[0]?.price?.unit_amount ?? null;
      } catch {}

      await upsertSubscription({
        business_id: meta.business_id,
        area_id: meta.area_id,
        category_id: meta.category_id,
        slot: meta.slot || 1,
        stripe_customer_id: String(custId),
        stripe_subscription_id: String(subId),
        status,
        price_monthly_pennies: pricePennies,
        currency: (sub?.currency || "gbp"),
        current_period_end: currentPeriodEndIso,
        lock_id: meta.lock_id,
      });

      return json({ ok: true });
    }

    // ---- invoice.paid / invoice.finalized etc ----
    // You can keep your invoicing/email logic here; we just ACK by default.
    if (t.startsWith("invoice.")) {
      return json({ ok: true });
    }

    // default: acknowledge
    return json({ ok: true });
  } catch (e) {
    console.error("[stripe-webhook] handler error:", e);
    return json({ ok: false, error: e?.message || "Webhook error" }, 500);
  }
};
