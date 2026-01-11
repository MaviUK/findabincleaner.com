// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

console.log("LOADED area-sponsorship v2026-01-11-ENV-FIX");

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

const DEFAULT_SLOTS = [1];

export default async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true }, 200);
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = getServiceRoleKey();
    if (!serviceRoleKey) {
      // Make the failure obvious in logs + response
      throw new Error(
        "Missing Supabase service role key env var (set SUPABASE_SERVICE_ROLE_KEY on Netlify)"
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const areaIds = Array.isArray(body?.areaIds) ? body.areaIds.filter(Boolean) : [];
    const cleaner_id =
      body?.cleaner_id || body?.business_id || body?.cleanerId || body?.businessId || null;

    const slots =
      Array.isArray(body?.slots) && body.slots.length
        ? body.slots.map((n) => Number(n)).filter((n) => Number.isFinite(n))
        : DEFAULT_SLOTS;

    // Optional (your UI is sending it) – not required to run this query
    // const categoryId = body?.categoryId ?? null;

    if (!areaIds.length) return json({ areas: [] }, 200);

    const { data: rows, error } = await supabase
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id, created_at")
      .in("area_id", areaIds)
      .in("slot", slots);

    if (error) throw error;

    // Group by area:slot
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

        // prefer most recent BLOCKING row if any
        const blockingRow = arr.find((r) =>
          BLOCKING.has(String(r.status || "").toLowerCase())
        );
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
        });
      }

      areasOut.push(areaObj);
    }

    return json({ areas: areasOut }, 200);
  } catch (err) {
    console.error("area-sponsorship fatal error:", err);
    return json({ error: String(err?.message || "Internal Server Error") }, 500);
  }
};
