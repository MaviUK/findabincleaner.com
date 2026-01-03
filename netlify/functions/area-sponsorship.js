// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

console.log("LOADED area-sponsorship v2026-01-03-SINGLE-SLOT+LOCKS+CATEGORY");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });

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

  const areaIds = Array.isArray(body?.areaIds)
    ? body.areaIds.filter(Boolean)
    : [];

  const cleaner_id =
    body?.cleaner_id ||
    body?.business_id ||
    body?.cleanerId ||
    body?.businessId ||
    null;

  // ✅ CATEGORY IS REQUIRED FOR CONSISTENCY
  const category_id = body?.categoryId || body?.category_id || null;

  // Allow caller to request specific slots, but default to [1]
  const slots =
    Array.isArray(body?.slots) && body.slots.length
      ? body.slots
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n))
      : DEFAULT_SLOTS;

  if (!areaIds.length) return json({ areas: [] });

  // If you want to allow "all categories", you could relax this.
  // But your UI is per-industry, and your preview + checkout are per-category,
  // so we enforce it here to prevent mismatches.
  if (!category_id) {
    return json(
      {
        error:
          "categoryId is required (dashboard + checkout must use the same category filter).",
      },
      400
    );
  }

  try {
    // 1) Pull subscription rows for these areas/slots/category
    const { data: subRows, error: subErr } = await supabase
      .from("sponsored_subscriptions")
      .select("area_id, slot, status, business_id, created_at, category_id")
      .in("area_id", areaIds)
      .in("slot", slots)
      .eq("category_id", category_id);

    if (subErr) throw subErr;

    // 2) Pull ACTIVE locks (unexpired) for these areas/slots/category
    const nowIso = new Date().toISOString();
    const { data: lockRows, error: lockErr } = await supabase
      .from("sponsored_locks")
      .select("area_id, slot, business_id, expires_at, is_active, category_id")
      .in("area_id", areaIds)
      .in("slot", slots)
      .eq("category_id", category_id)
      .eq("is_active", true)
      .gt("expires_at", nowIso);

    if (lockErr) throw lockErr;

    // Group subs by area:slot
    const subsByAreaSlot = new Map(); // key `${area}:${slot}` => array
    for (const r of subRows || []) {
      const k = `${r.area_id}:${r.slot}`;
      if (!subsByAreaSlot.has(k)) subsByAreaSlot.set(k, []);
      subsByAreaSlot.get(k).push(r);
    }

    // Group locks by area:slot (should be 0 or 1 usually)
    const locksByAreaSlot = new Map(); // key `${area}:${slot}` => lock row
    for (const l of lockRows || []) {
      const k = `${l.area_id}:${l.slot}`;
      // keep the latest expiry if multiple (defensive)
      const existing = locksByAreaSlot.get(k);
      if (!existing) {
        locksByAreaSlot.set(k, l);
      } else {
        const a = new Date(existing.expires_at).getTime();
        const b = new Date(l.expires_at).getTime();
        if (b > a) locksByAreaSlot.set(k, l);
      }
    }

    // Build response
    const areasOut = [];
    for (const area_id of areaIds) {
      const areaObj = { area_id, slots: [] };

      for (const slot of slots) {
        const k = `${area_id}:${slot}`;
        const arr = subsByAreaSlot.get(k) || [];

        // newest first
        arr.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // prefer most recent BLOCKING row if any
        const blockingRow = arr.find((r) =>
          BLOCKING.has(String(r.status || "").toLowerCase())
        );
        const chosen = blockingRow ?? arr[0] ?? null;

        const status = chosen?.status ?? null;
        const owner_business_id = chosen?.business_id ?? null;

        const taken =
          !!chosen && BLOCKING.has(String(status || "").toLowerCase());

        const taken_by_me =
          Boolean(cleaner_id) &&
          Boolean(owner_business_id) &&
          String(owner_business_id) === String(cleaner_id);

        const lock = locksByAreaSlot.get(k) || null;
        const locked = !!lock;
        const locked_by_business_id = lock?.business_id ?? null;

        const locked_by_me =
          locked &&
          Boolean(cleaner_id) &&
          Boolean(locked_by_business_id) &&
          String(locked_by_business_id) === String(cleaner_id);

        const locked_by_other =
          locked &&
          Boolean(locked_by_business_id) &&
          (!cleaner_id ||
            String(locked_by_business_id) !== String(cleaner_id));

        areaObj.slots.push({
          slot,

          // subscription state
          taken,
          taken_by_me,
          status,
          owner_business_id,

          // lock state (checkout holds)
          locked,
          locked_by_me,
          locked_by_other,
          lock_expires_at: lock?.expires_at ?? null,
          locked_by_business_id,
        });
      }

      areasOut.push(areaObj);
    }

    return json({ areas: areasOut });
  } catch (err) {
    console.error("area-sponsorship fatal error:", err);
    return json({ error: "Internal Server Error" }, 500);
  }
};
