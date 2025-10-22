// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// ---------- pricing helpers ----------
function readNum(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

const RATE_DEFAULT = readNum("RATE_PER_KM2_PER_MONTH", 15);
const MIN_DEFAULT  = readNum("MIN_PRICE_PER_MONTH", 1);

const RATE_TIER = {
  1: readNum("RATE_GOLD_PER_KM2_PER_MONTH", RATE_DEFAULT),
  2: readNum("RATE_SILVER_PER_KM2_PER_MONTH", RATE_DEFAULT),
  3: readNum("RATE_BRONZE_PER_KM2_PER_MONTH", RATE_DEFAULT),
};
const MIN_TIER = {
  1: readNum("MIN_GOLD_PRICE_PER_MONTH", MIN_DEFAULT),
  2: readNum("MIN_SILVER_PRICE_PER_MONTH", MIN_DEFAULT),
  3: readNum("MIN_BRONZE_PRICE_PER_MONTH", MIN_DEFAULT),
};

// Treat these as "owned/held" states that should reserve a slot
const ACTIVEISH = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
  "requires_payment_method",
  "requires_action",
]);

// ---------- ownership guard ----------
async function isSlotTakenByAnother(areaId, slot, myBusinessId) {
  try {
    const { data, error } = await sb
      .from("sponsored_subscriptions")
      .select("business_id,cleaner_id,status,stripe_payment_intent_id")
      .eq("area_id", areaId)
      .eq("slot", Number(slot));

    if (error) {
      console.error("[sponsored-preview] ownership query error:", error);
      // Conservative: if we cannot prove it's free, treat as taken to avoid oversell
      return true;
    }

    for (const row of data || []) {
      const owner =
        row?.business_id != null ? row.business_id :
        row?.cleaner_id  != null ? row.cleaner_id  :
        null;

      const owned =
        ACTIVEISH.has(row?.status) || Boolean(row?.stripe_payment_intent_id);

      if (owned && owner && String(owner) !== String(myBusinessId)) {
        return true;
      }
    }
    return false;
  } catch (e) {
    console.error("[sponsored-preview] ownership guard exception:", e);
    return true; // conservative
  }
}

// ---------- clipping helpers ----------
async function rpcClipBySlot(areaId, slot) {
  // Try your slot-specific RPCs first (authoritative per-slot clipping)
  const proc =
    Number(slot) === 1
      ? "clip_available_slot1_preview"
      : Number(slot) === 2
      ? "clip_available_slot2_preview"
      : "clip_available_slot3_preview";

  const { data, error } = await sb.rpc(proc, {
    p_area_id: areaId,
    // If your RPC also accepts the requesting cleaner to exclude, add p_cleaner if needed:
    // p_cleaner: cleanerId,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  // Expect row: { area_m2, final_geojson } (or similar)
  const area_m2 = Number(row?.area_m2 ?? row?.area_sq_m ?? 0);
  const area_km2 = Math.max(0, area_m2 / 1_000_000);
  const final_geojson =
    row?.final_geojson ??
    row?.available_geojson ??
    row?.available ??
    row?.geojson ??
    row?.geometry ??
    row?.multi ??
    null;

  return { area_km2, final_geojson };
}

async function rpcGenericPreview(areaId, slot) {
  // Fall back to your generic RPC if slot-specific ones are not present
  const { data, error } = await sb.rpc("get_area_preview", {
    _area_id: areaId,
    _slot: Number(slot),
    _drawn_geojson: null,
    _exclude_cleaner: null,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  const area_km2 = Number(row?.area_km2 ?? 0);
  const final_geojson =
    row?.final_geojson ??
    row?.available_geojson ??
    row?.available ??
    row?.geojson ??
    row?.geometry ??
    row?.multi ??
    null;

  return { area_km2: Math.max(0, area_km2), final_geojson };
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const { cleanerId, areaId, slot } = await req.json();
    if (!cleanerId || !areaId || ![1, 2, 3].includes(Number(slot))) {
      return json({ ok: false, error: "Missing or invalid params" }, 400);
    }

    // 1) Hard signal if slot already owned by another business
    const takenByOther = await isSlotTakenByAnother(areaId, Number(slot), String(cleanerId));
    if (takenByOther) {
      return json({
        ok: true,
        area_km2: 0,
        monthly_price: 0,
        final_geojson: null,
        taken_by_other: true,
      });
    }

    // 2) Compute per-slot available geometry (clipped)
    let area_km2 = 0;
    let final_geojson = null;
    try {
      ({ area_km2, final_geojson } = await rpcClipBySlot(areaId, Number(slot)));
    } catch (e) {
      // If slot-specific RPCs are missing on your stack, fall back to generic
      console.warn("[sponsored-preview] slot RPC failed, using generic get_area_preview:", e?.message);
      ({ area_km2, final_geojson } = await rpcGenericPreview(areaId, Number(slot)));
    }

    // 3) Price for this slot (respecting mins)
    const rate = RATE_TIER[Number(slot)] ?? RATE_DEFAULT;
    const min  = MIN_TIER[Number(slot)]  ?? MIN_DEFAULT;
    const monthly = Math.max(min, Math.max(0, Number(area_km2)) * rate);

    return json({
      ok: true,
      area_km2: Number(Number(area_km2).toFixed(6)),
      monthly_price: Number(Number(monthly).toFixed(2)),
      final_geojson,
    });
  } catch (e) {
    console.error("[sponsored-preview] fatal:", e);
    // Keep 200 with ok:false so UI can show error nicely
    return json({ ok: false, error: "Preview failed" }, 200);
  }
};
