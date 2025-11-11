// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";
import area from "@turf/area";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }); }

  const areaId = String(body.areaId || body.area_id || "").trim();
  const businessId = String(body.businessId || body.cleanerId || "").trim();
  const slot = 1;

  if (!areaId) return json({ ok: false, error: "Missing areaId" });
  if (!businessId) return json({ ok: false, error: "Missing businessId" });

  try {
    // 1) SOLD-OUT check (another owner currently holds the featured slot)
    const { data: ownerRow, error: ownerErr } = await sb
      .from("v_featured_slot_owner")
      .select("owner_business_id")
      .eq("area_id", areaId)
      .eq("slot", slot)
      .maybeSingle();

    if (ownerErr) throw ownerErr;

    const ownedByOther =
      ownerRow && ownerRow.owner_business_id && ownerRow.owner_business_id !== businessId;

    // 2) Remaining sub-geometry and area (km²)
    //    NOTE: even if geometry says >0, if ownedByOther is true we treat it as sold out.
    const { data: prev, error: prevErr } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });
    if (prevErr) throw prevErr;

    const row = Array.isArray(prev) ? prev[0] : prev;
    const area_km2 = Number(row?.area_km2 ?? 0) || 0;
    const geojson = row?.gj ?? null;

    // 3) Total area of the saved area (km²)
    let total_km2 = null;
    const { data: sa, error: saErr } = await sb
      .from("service_areas")
      .select("gj")
      .eq("id", areaId)
      .maybeSingle();
    if (sa?.gj && !saErr) {
      try {
        const m2 = area(sa.gj);
        if (Number.isFinite(m2)) total_km2 = m2 / 1_000_000;
      } catch { /* ignore */ }
    }

    // clamp available to total if both exist
    const available_km2 =
      total_km2 != null ? Math.max(0, Math.min(area_km2, total_km2)) : area_km2;

    // price (your env rate)
    const rate_per_km2 = Number(process.env.RATE_PER_KM2_PER_MONTH || 0);
    const price_cents = Math.round((ownedByOther ? 0 : available_km2) * rate_per_km2 * 100);

    return json({
      ok: true,
      sold_out: !!ownedByOther,
      area_km2: ownedByOther ? 0 : available_km2, // if sold out, present 0
      total_km2,
      rate_per_km2,
      price_cents,
      geojson: ownedByOther ? null : geojson,     // do not preview if sold out
      message: ownedByOther ? "Featured slot is already owned by another business." : null,
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
