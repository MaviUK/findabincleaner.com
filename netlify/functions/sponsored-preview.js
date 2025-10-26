// netlify/functions/sponsored-preview.js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const businessId = body.businessId || body.cleanerId;
  const areaId = body.areaId || body.area_id;
  const slot = Number(body.slot);

  if (!businessId || !areaId || !slot) return json({ ok: false, error: "cleanerId/areaId/slot required" }, 400);

  try {
    // --- YOUR EXISTING PREVIEW / CLIP LOGIC HERE ---
    // For illustration we assume you computed:
    //   areaKm2: number
    //   monthlyPrice: number (GBP)
    //   clipped: GeoJSON (MultiPolygon, Polygon, or Feature/FC)

   // ✅ Your actual results from the existing preview logic
const areaKm2 = result.area_km2;            // number
const monthlyPrice = result.monthly_price;  // number in GBP
const clipped = result.final_geojson;       // clipped MultiPolygon for the overlay


    // Build cache row (15 minute validity)
    const monthlyCents = Math.max(0, Math.round(Number(monthlyPrice) * 100));
    const { data: ins, error: insErr } = await sb
      .from("sponsored_preview_cache")
      .insert({
        business_id: businessId,
        area_id: areaId,
        slot,
        area_km2: Number(areaKm2) || 0,
        monthly_price_cents: monthlyCents,
        clipped_geojson: clipped ?? null,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single();

    if (insErr || !ins) return json({ ok: false, error: "Failed to persist preview" }, 500);

    // Create a lightweight URL that your checkout can re-load/validate
    const previewUrl = `${process.env.PUBLIC_SITE_URL}/.netlify/functions/sponsored-preview?previewId=${ins.id}`;

    return json({
      ok: true,
      area_km2: areaKm2,
      monthly_price: monthlyPrice,
      final_geojson: clipped,       // your UI uses this for the green overlay
      preview_url: previewUrl,      // <— IMPORTANT
    });
  } catch (e) {
    console.error("[sponsored-preview] error:", e);
    return json({ ok: false, error: "Preview failed" }, 500);
  }
};
