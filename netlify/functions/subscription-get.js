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
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { businessId, cleanerId, areaId, slot } = await req.json();

    if (!areaId || !slot || ![1, 2, 3].includes(Number(slot))) {
      return json({ ok: false, error: "Missing areaId/slot" }, 400);
    }

    // Resolve business id from cleanerId if not provided
    let bid = businessId || null;
    if (!bid && cleanerId) {
      const { data, error } = await supabase
        .from("cleaners")
        .select("id")
        .eq("user_id", cleanerId)
        .maybeSingle();
      if (error) {
        console.error("[sub-get] cleaners lookup error:", error);
        return json({ ok: false, error: "Lookup failed" }, 500);
      }
      bid = data ? data.id : null;
    }

    if (!bid) return json({ ok: false, error: "Missing params" }, 400);

    const { data: sub, error: subErr } = await supabase
      .from("sponsored_subscriptions")
      .select(
        `
        status,
        current_period_end,
        price_monthly_pennies,
        area_id,
        service_areas!inner(name)
      `
      )
      .eq("business_id", bid)
      .eq("area_id", areaId)
      .eq("slot", Number(slot))
      .maybeSingle();

    if (subErr) {
      console.error("[sub-get] query error:", subErr);
      return json({ ok: false, error: "Query failed" }, 500);
    }

    if (!sub) return json({ ok: false, notFound: true }, 200);

    return json({
      ok: true,
      subscription: {
        area_name: sub.service_areas ? sub.service_areas.name : null,
        status: sub.status || null,
        current_period_end: sub.current_period_end || null,
        price_monthly_pennies: sub.price_monthly_pennies || null,
      },
    });
  } catch (e) {
    console.error("[sub-get] handler error:", e);
    return json({ ok: false, error: e && e.message ? e.message : "Server error" }, 500);
  }
};
