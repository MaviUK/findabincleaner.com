// netlify/functions/sponsored-checkout.js
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/** small helpers */
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const GBP = (n) => Math.max(0, Math.round(n * 100)); // to pence, >= 0

/** Only allow preview URLs we generated (your domain + our function path). */
function isSafePreviewUrl(url) {
  try {
    const u = new URL(url);
    const hostOk =
      (process.env.PUBLIC_SITE_URL && u.origin === new URL(process.env.PUBLIC_SITE_URL).origin) ||
      u.hostname.endsWith("netlify.app"); // belt & braces for preview deploys
    const pathOk =
      u.pathname.includes("/.netlify/functions/sponsored-preview") ||
      u.pathname.includes("/api/sponsored/preview");
    return hostOk && pathOk;
  } catch {
    return false;
  }
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ---- read and validate input
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { businessId, areaId, slot, previewUrl } = body || {};
  if (!businessId || !areaId || !slot) return json({ error: "businessId, areaId, slot required" }, 400);
  if (!previewUrl || !isSafePreviewUrl(previewUrl)) {
    return json({ error: "Valid previewUrl required" }, 400);
  }

  // ---- 1) block if another business already owns this slot in THIS area
  // (quick check to short-circuit obvious conflicts)
  const BLOCKING = ["active", "trialing", "past_due", "unpaid"];
  const { data: conflicts, error: conflictErr } = await sb
    .from("sponsored_subscriptions")
    .select("id,business_id,status")
    .eq("area_id", areaId)
    .eq("slot", slot)
    .neq("business_id", businessId)
    .in("status", BLOCKING)
    .limit(1);

  if (conflictErr) return json({ error: "DB error (conflict)" }, 500);
  if (conflicts?.length) return json({ error: "Slot already taken in this area" }, 409);

  // ---- 2) fetch the authoritative preview server-side
  // This contains the geo clip across ALL areas and returns:
  //   { ok, area_km2, monthly_price, final_geojson }
  let preview;
  try {
    const res = await fetch(previewUrl, { method: "GET" });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return json({ error: `Preview ${res.status}${txt ? ` – ${txt}` : ""}` }, 502);
    }
    preview = await res.json();
  } catch (e) {
    return json({ error: `Failed to parse URL from .netlify/functions/sponsored-preview` }, 502);
  }

  if (!preview?.ok) return json({ error: "Preview failed" }, 502);

  const areaKm2 = Number(preview.area_km2 || 0);
  const monthlyPrice = Number(preview.monthly_price || 0);

  // **Hard guard** — if preview says zero purchasable area, we refuse checkout.
  if (!(areaKm2 > 0) || !(monthlyPrice >= 0)) {
    return json({ error: "No purchasable area available for this slot" }, 409);
  }

  // ---- 3) reuse or create provisional row for this (business, area, slot)
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
        // Optional: persist the preview numbers we priced from for reconciliation
        preview_area_km2: areaKm2,
        preview_monthly_price: monthlyPrice,
      })
      .select("id")
      .single();
    if (insErr || !inserted) return json({ error: "Could not create a provisional subscription" }, 409);
    subRowId = inserted.id;
  }

  // ---- 4) Create the Stripe session using the previewed monthly price (in pence)
  const unitAmount = GBP(monthlyPrice);
  if (unitAmount <= 0) return json({ error: "Invalid price" }, 400);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price_data: {
          currency: "gbp",
          product_data: {
            name: `Sponsor Slot #${slot} — Area ${areaId.slice(0, 8)}…`,
            description: `Geo-clipped subscription based on your current preview.`
          },
          recurring: { interval: "month" },
          unit_amount: unitAmount,
        },
        quantity: 1,
      },
    ],
    metadata: {
      sub_row_id: subRowId,
      business_id: businessId,
      area_id: areaId,
      slot: String(slot),
      preview_area_km2: String(areaKm2),
      preview_price_gbp: String(monthlyPrice),
    },
    success_url: `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=success`,
    cancel_url: `${process.env.PUBLIC_SITE_URL}/#/dashboard?checkout=cancel`,
  });

  return json({ url: session.url });
};
