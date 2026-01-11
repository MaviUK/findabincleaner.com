// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

console.log("LOADED area-sponsorship v2026-01-11-SPONSORED_GEOJSON-FIRST");

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function getServiceRoleKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY
  );
}

const supabase = createClient(requireEnv("SUPABASE_URL"), getServiceRoleKey(), {
  auth: { persistSession: false },
});

// statuses that should block purchase (treated as "taken")
const BLOCKING = new Set(["active", "trialing", "past_due"]);
const DEFAULT_SLOTS = [1];

export default async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const areaIds = Array.isArray(body?.areaIds) ? body.areaIds.filter(Boolean) : [];
  const slots =
    Array.isArray(body?.slots) && body.slots.length
      ? body.slots.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : DEFAULT_SLOTS;

  if (!areaIds.length) return json({ areas: [] }, 200);

  try {
    // ✅ IMPORTANT: select sponsored_geojson (real GeoJSON) and status/owner
    const { data: rows, error } = await supabase
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id, created_at, sponsored_geojson")
      .in("area_id", areaIds)
      .in("slot", slots)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Group rows by area:slot (already sorted newest-first)
    const byKey = new Map();
    for (const r of rows || []) {
      const k = `${r.area_id}:${r.slot}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(r);
    }

    const areasOut = [];
    for (const area_id of areaIds) {
      const areaObj = { area_id, slots: [] };

      for (const slot of slots) {
        const k = `${area_id}:${slot}`;
        const arr = byKey.get(k) || [];

        // Prefer newest BLOCKING row; else newest row
        const blockingRow = arr.find((r) =>
          BLOCKING.has(String(r.status || "").toLowerCase())
        );
        const chosen = blockingRow ?? arr[0] ?? null;

        const status = chosen?.status ?? null;
        const owner_business_id = chosen?.business_id ?? null;
        const taken = !!chosen && BLOCKING.has(String(status || "").toLowerCase());

        const sponsored_geojson = chosen?.sponsored_geojson ?? null;

        areaObj.slots.push({
          slot,
          taken,
          status,
          owner_business_id,
          sponsored_geojson,
        });
      }

      areasOut.push(areaObj);
    }

    return json({ areas: areasOut }, 200);
  } catch (err) {
    console.error("area-sponsorship fatal error:", err);
    return json({ error: "Internal Server Error" }, 500);
  }
};
