const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Safe env number reader
function envNumber(name, fallback = null) {
  const raw = process.env[name];
  const n = raw == null ? NaN : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

export default async (req) => {
if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
@@ -16,42 +21,50 @@ export default async (req) => {
try {
body = await req.json();
} catch {
    return json({ ok: false, error: "Invalid JSON body" }); // 200 with ok:false on client
    return json({ ok: false, error: "Invalid JSON" }, 400);
}

  const areaId = (body.areaId || body.area_id || "").trim();
  const slot = Number(body.slot);
  const { businessId, areaId, slot } = body ?? {};
  if (!businessId || !areaId || !slot) return json({ ok: false, error: "Missing params" }, 400);

  if (!areaId || !/^[0-9a-f-]{36}$/i.test(areaId)) {
    return json({ ok: false, error: "Missing or invalid areaId" });
  }
  if (![1, 2, 3].includes(slot)) {
    return json({ ok: false, error: "Missing or invalid slot (1..3)" });
  // Read rates once
  const RATES = {
    1: envNumber("RATE_GOLD_PER_KM2_PER_MONTH"),
    2: envNumber("RATE_SILVER_PER_KM2_PER_MONTH"),
    3: envNumber("RATE_BRONZE_PER_KM2_PER_MONTH"),
  };

  // Fail fast with a clear message if any rate is not configured
  if (!Number.isFinite(RATES[1]) || !Number.isFinite(RATES[2]) || !Number.isFinite(RATES[3])) {
    return json({
      ok: false,
      error: "Pricing rates not configured. Set RATE_GOLD_PER_KM2_PER_MONTH, RATE_SILVER_PER_KM2_PER_MONTH, and RATE_BRONZE_PER_KM2_PER_MONTH in Netlify env.",
    }, 500);
}

try {
    // Call a tiny SQL helper that reads from v_area_slot_remaining and returns km2 + geojson
    const { data, error } = await sb.rpc("area_remaining_preview", {
      p_area_id: areaId,
      p_slot: slot,
    });
    // ...your geometry work to compute purchaseable area for this slot...
    // Assume you compute area_km2 as a Number > 0
    const area_km2 = /* your computed value */ null;

    if (error) {
      return json({ ok: false, error: error.message || "Preview query failed" });
    if (!Number.isFinite(area_km2)) {
      return json({ ok: false, error: "Geometry operation failed" }, 400);
}

    // If no row, treat as zero/none rather than throwing
    const row = Array.isArray(data) ? data[0] : data;

    const area_km2 = Number(row?.area_km2 ?? 0);
    const geojson = row?.gj ?? null;
    const ratePerKm2 = RATES[slot] ?? 0;
    const monthly_price_cents = Math.round(area_km2 * ratePerKm2 * 100);

return json({
ok: true,
      slot,
area_km2,
      geojson, // this is a GeoJSON geometry or null
      rate_per_km2_per_month: ratePerKm2,         // for transparency
      monthly_price_cents,
      monthly_price_display: (monthly_price_cents / 100).toFixed(2),
      // preview_geojson: <your preview geometry if you return it>
});
  } catch (e) {
    return json({ ok: false, error: e?.message || "Server error" });
  } catch (err) {
    console.error("sponsored-preview error:", err);
    return json({ ok: false, error: "Server error" }, 500);
}
};
