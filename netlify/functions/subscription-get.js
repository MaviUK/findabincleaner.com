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

export default async (req, context) => {
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

    const businessId = body?.businessId || null; // cleaners.id
    const areaId = body?.areaId || null;
    const slot = parseInt(body?.slot, 10);

    console.log("[subscription-get] payload:", { businessId, areaId, slot });

    if (!businessId || !areaId || ![1, 2, 3].includes(slot)) {
      return json({ ok: false, error: "Missing params" }, 400);
    }

    // Look up the user’s sponsorship for this area/slot
    const { data: subRow, error: subErr } = await supabase
      .from("sponsored_subscriptions")
      .select(
        `
        id,
        business_id,
        area_id,
        slot,
        status,
        price_monthly_pennies,
        current_period_end,
        service_areas(name)
      `
      )
      .eq("business_id", businessId)
      .eq("area_id", areaId)
      .eq("slot", slot)
      .maybeSingle();

    if (subErr) {
      console.error("[subscription-get] DB error:", subErr);
      return json({ ok: false, error: "DB error" }, 500);
    }

    if (!subRow) {
      return json({ ok: false, notFound: true }, 200);
    }

    return json({
      ok: true,
      subscription: {
        area_name: subRow.service_areas?.name ?? null,
        status: subRow.status ?? null,
        current_period_end: subRow.current_period_end ?? null,
        price_monthly_pennies: subRow.price_monthly_pennies ?? null,
      },
    });
  } catch (e) {
    console.error("[subscription-get] Uncaught error:", e);
    return json({ ok: false, error: "Server error" }, 500);
  }
};
