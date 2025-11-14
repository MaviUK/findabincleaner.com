import { createClient } from "@supabase/supabase-js";
import area from "@turf/area";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

// HTTP helper
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// statuses that block a slot
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

// sane epsilon for float comparisons
const EPS = 1e-6;

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const areaId = (body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot || 1);
  const businessId = (body.businessId || body.cleanerId || "").trim();

  if (!areaId) return json({ ok: false, error: "Missing areaId" }, 400);
  if (![1].includes(slot)) return json({ ok: false, error: "Invalid slot" }, 400); // single “featured” slot
  if (!businessId) return json({ ok: false, error: "Missing businessId" }, 400);

  try {
    // 1) Is the slot already owned by someone else?
    const { data: takenRows, error: takenErr } = await sb
      .from("sponsored_subscriptions")
      .select("business_id, status")
      .eq("area_id", areaId)
      .eq("slot", slot);

    if (takenErr) throw takenErr;

    // keep only *blocking* rows
    const blocking = (takenRows || []).filter(
      (r) => BLOCKING.has(String(r.status || "").toLowerCase())
    );

    const ownedByOther =
      (blocking?.length || 0) > 0 &&
      String(blocking[0].business_id) !== String(businessId);

    // 2) Ask DB for remaining purchasable geometry (may be zero if fully occupied)
    //    This RPC returns: [{ area_km2, gj }] or a single row; handle both.
    const { data: previewRow, error: prevErr } = await sb.rpc("area_remaining_preview", {
  p_area_id: areaId,
  p_slot: slot,
});
if (prevErr) throw prevErr;

const row = Array.isArray(previewRow) ? (previewRow[0] || {}) : (previewRow || {});

// Support the current function shape (available_km2) and older area_km2 just in case
const remainingField =
  row.available_km2 ?? row.area_km2 ?? row.remaining_km2 ?? 0;

let remaining_km2 = Number(remainingField) || 0;
const geojson = row.gj ?? row.geojson ?? null;

    // 3) Also compute the *total* area of the saved service area, for the modal’s “Total area”
    let total_km2 = null;
    const { data: sa, error: saErr } = await sb
      .from("service_areas")
      .select("gj")
      .eq("id", areaId)
      .maybeSingle();
    if (!saErr && sa?.gj) {
      try {
        const m2 = area(sa.gj);
        if (Number.isFinite(m2)) total_km2 = m2 / 1_000_000;
      } catch { /* ignore */ }
    }

    // 4) Slot already owned by someone else → force sold-out, zero availability
    const sold_out = ownedByOther || remaining_km2 <= EPS;
    if (ownedByOther) remaining_km2 = 0;

    // 5) Rate & price
    const rate_per_km2 =
      Number(
        process.env.RATE_GOLD_PER_KM2_PER_MONTH ?? process.env.RATE_PER_KM2_PER_MONTH ?? 0
      ) || 0;
    const price_cents = Math.round(Math.max(remaining_km2, 0) * rate_per_km2 * 100);

    return json({
      ok: true,
      sold_out,
      available_km2: Math.max(0, remaining_km2),
      total_km2,
      rate_per_km2,
      price_cents,
      geojson,
      reason: ownedByOther ? "owned_by_other" : remaining_km2 <= EPS ? "no_remaining" : "ok",
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
