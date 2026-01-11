// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

console.log("LOADED area-sponsorship v2026-01-11-SPONSORED_GEOJSON-RETURN");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function getSupabaseAdmin() {
  const url = requireEnv("SUPABASE_URL");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY;

  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE");
  return createClient(url, key, { auth: { persistSession: false } });
}

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

// Only real blocking statuses
const BLOCKING = new Set(["active", "trialing", "past_due"]);
const DEFAULT_SLOTS = [1];

export default async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true }, 200);
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const areaIds = Array.isArray(body?.areaIds) ? body.areaIds.filter(Boolean) : [];

    // optional - used only for taken_by_me (UI doesn't currently use it, but keep)
    const cleaner_id =
      body?.cleaner_id ||
      body?.business_id ||
      body?.cleanerId ||
      body?.businessId ||
      null;

    const slots =
      Array.isArray(body?.slots) && body.slots.length
        ? body.slots.map((n) => Number(n)).filter((n) => Number.isFinite(n))
        : DEFAULT_SLOTS;

    if (!areaIds.length) return json({ areas: [] });

    const supabase = getSupabaseAdmin();

    // ✅ pull sponsored_geojson directly
    const { data: rows, error } = await supabase
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id, created_at, sponsored_geojson")
      .in("area_id", areaIds)
      .in("slot", slots);

    if (error) throw error;

    // group rows by area:slot
    const byAreaSlot = new Map();
    for (const r of rows || []) {
      const k = `${r.area_id}:${r.slot}`;
      if (!byAreaSlot.has(k)) byAreaSlot.set(k, []);
      byAreaSlot.get(k).push(r);
    }

    const areasOut = [];
    for (const area_id of areaIds) {
      const areaObj = { area_id, slots: [] };

      for (const slot of slots) {
        const k = `${area_id}:${slot}`;
        const arr = byAreaSlot.get(k) || [];

        // newest first
        arr.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // prefer most recent blocking row
        const blockingRow = arr.find((r) => BLOCKING.has(String(r.status || "").toLowerCase()));
        const chosen = blockingRow ?? arr[0] ?? null;

        const status = chosen?.status ?? null;
        const owner_business_id = chosen?.business_id ?? null;
        const taken = !!chosen && BLOCKING.has(String(status || "").toLowerCase());
        const taken_by_me =
          Boolean(cleaner_id) &&
          Boolean(owner_business_id) &&
          String(owner_business_id) === String(cleaner_id);

        areaObj.slots.push({
          slot,
          taken,
          taken_by_me,
          status,
          owner_business_id,
          // ✅ THIS is what the map needs
          sponsored_geojson: chosen?.sponsored_geojson ?? null,
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
