// netlify/functions/subscription-get.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async (req) => {
  try {
    if (req.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const businessId = body?.businessId ?? null; // cleaners.id (business id)
    const areaId = body?.areaId ?? null;
    const slot = parseInt(body?.slot, 10);

    console.log("[subscription-get] payload:", { businessId, areaId, slot });

    if (!businessId || !areaId || ![1, 2, 3].includes(slot)) {
      return json({ ok: false, error: "Missing params" }, 400);
    }

    // 1) Get the subscription row WITHOUT a relational select
    const { data: subRow, error: subErr } = await supabase
      .from("sponsored_subscriptions")
      .select(
        // keep this list to columns you know exist in your table
        "id, business_id, area_id, slot, status, price_monthly_pennies, current_period_end"
      )
      .eq("business_id", businessId)
      .eq("area_id", areaId)
      .eq("slot", slot)
      .maybeSingle();

    if (subErr) {
      console.error("[subscription-get] DB error (subs):", subErr);
      return json({ ok: false, error: "DB error" }, 500);
    }

    if (!subRow) {
      return json({ ok: false, notFound: true }, 200);
    }

    // 2) (Optional) fetch the area name separately; safe even without FK
    let areaName = null;
    const { data: areaRow, error: areaErr } = await supabase
      .from("service_areas")
      .select("name")
      .eq("id", areaId)
      .maybeSingle();
    if (areaErr) {
      console.warn("[subscription-get] area name lookup failed:", areaErr);
    } else {
      areaName = areaRow?.name ?? null;
    }

    return json({
      ok: true,
      subscription: {
        area_name: areaName,
        status: subRow.status ?? null,
        current_period_end: subRow.current_period_end ?? null,
        price_monthly_pennies:
          typeof subRow.price_monthly_pennies === "number"
            ? subRow.price_monthly_pennies
            : null,
      },
    });
  } catch (e) {
    console.error("[subscription-get] Uncaught error:", e);
    return json({ ok: false, error: "Server error" }, 500);
  }
}
