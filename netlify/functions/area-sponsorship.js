// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

console.log("LOADED area-sponsorship v2026-01-11-SINGLE-SLOT+SPONSORED_GEOJSON_FIX");

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

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

// statuses that should block purchase (treated as "taken")
const BLOCKING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

// ✅ default to SINGLE SLOT (Featured)
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
  const cleaner_id =
    body?.cleaner_id || body?.business_id || body?.cleanerId || body?.businessId || null;

  // Allow caller to request specific slots, but default to [1]
  const slots =
    Array.isArray(body?.slots) && body.slots.length
      ? body.slots
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n))
      : DEFAULT_SLOTS;

  if (!areaIds.length) return json({ areas: [] });

  try {
    // ✅ IMPORTANT: select sponsored_geojson (the purchased sub-geometry)
    const { data: rows, error } = await supabase
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id, created_at, sponsored_geojson")
      .in("area_id", areaIds)
      .in("slot", slots);

    if (error) throw error;

    // Group by area:slot
    const byAreaSlot = new Map(); // key = `${area}:${slot}` -> array of rows
    for (const r of rows || []) {
      const k = `${r.area_id}:${r.slot}`;
      if (!byAreaSlot.has(k)) byAreaSlot.set(k, []);
      byAreaSlot.get(k).push(r);
    }
