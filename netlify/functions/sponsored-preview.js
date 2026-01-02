// netlify/functions/sponsored-preview.js
// Server-side preview used by the Sponsor modal.
// IMPORTANT: this MUST reflect the DB's availability logic so the UI can't offer checkout when DB would reject.

const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  { auth: { persistSession: false } }
);

const json = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function getRateForCategory(categoryId) {
  // You can swap this to a DB table later; keeping your existing env-driven pricing.
  const { RATE_GOLD_GBP_PENNIES_PER_KM2_MONTH, RATE_SILVER_GBP_PENNIES_PER_KM2_MONTH } =
    process.env;

  // If you have multiple categories, map them however you like.
  // Default: use GOLD if set, otherwise 100 pennies (=£1) per km² / month
  const gold = Number(RATE_GOLD_GBP_PENNIES_PER_KM2_MONTH || 100);
  const silver = Number(RATE_SILVER_GBP_PENNIES_PER_KM2_MONTH || 100);

  // Simple heuristic: if you later want per-category pricing, do it here.
  // For now: use gold as default.
  return Number.isFinite(gold) ? gold : silver;
}

async function resolveCategoryId(areaId, categoryIdMaybe) {
  if (categoryIdMaybe) return categoryIdMaybe;

  const { data, error } = await supabaseAdmin
    .from("service_areas")
    .select("category_id")
    .eq("id", areaId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.category_id || null;
}

async function callAreaRemainingPreview(areaId, slot, categoryId) {
  // Prefer newer DB signature: (p_area_id, p_slot)
  const first = await supabaseAdmin.rpc("area_remaining_preview", {
    p_area_id: areaId,
    p_slot: slot,
  });

  if (!first.error) return first;

  // Fallback: older signature: (p_area_id, p_category_id, p_slot)
  const msg = String(first.error?.message || "");
  const looksLikeSignatureIssue =
    msg.includes("Could not find the function") ||
    msg.includes("function") && msg.includes("does not exist") ||
    msg.includes("structure of query does not match") ||
    msg.includes("result type");

  if (!looksLikeSignatureIssue) return first;

  return await supabaseAdmin.rpc("area_remaining_preview", {
    p_area_id: areaId,
    p_category_id: categoryId,
    p_slot: slot,
  });
}

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const areaId = qs.areaId || qs.area_id;
    const slot = Number(qs.slot || 1);
    const categoryIdIncoming = qs.categoryId || qs.category_id || null;

    if (!areaId) return json(400, { error: "Missing areaId" });
    if (!Number.isFinite(slot) || slot < 1) return json(400, { error: "Invalid slot" });

    // Resolve category_id (used only for pricing + backwards-compat fallback)
    const categoryId = await resolveCategoryId(areaId, categoryIdIncoming);

    // Call DB source-of-truth availability
    const { data, error } = await callAreaRemainingPreview(areaId, slot, categoryId);
    if (error) return json(500, { error: error.message });

    const row = Array.isArray(data) ? data[0] : data;
    const total_km2 = Number(row?.total_km2 ?? 0);
    const available_km2 = Number(row?.available_km2 ?? 0);
    const reason = row?.reason ?? null;
    const gj = row?.gj ?? null;

    // Determine sold out safely (DB may also return sold_out; treat either as truth)
    const sold_out =
      Boolean(row?.sold_out) || !Number.isFinite(available_km2) || available_km2 <= 1e-9;

    // Pricing from env (pennies per km² / month)
    const ratePerKm2Pennies = getRateForCategory(categoryId);
    const ratePerKm2 = ratePerKm2Pennies / 100;

    // Floor price: £1 minimum (matches what you show in UI)
    const minimumMonthly = 1.0;
    const rawMonthly = ratePerKm2 * Math.max(0, available_km2);
    const monthlyPrice = Math.max(minimumMonthly, rawMonthly);

    return json(200, {
      areaId,
      slot,
      categoryId,
      total_km2,
      available_km2,
      sold_out,
      reason: sold_out ? reason || "no_remaining" : reason || "ok",
      gj,
      // UI fields
      ratePerKm2,
      minimumMonthly,
      monthlyPrice,
      currency: "gbp",
    });
  } catch (e) {
    return json(500, { error: e?.message || "Server error" });
  }
};
