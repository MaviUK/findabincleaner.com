// netlify/functions/area-sponsorship.js
import { createClient } from "@supabase/supabase-js";

console.log("LOADED area-sponsorship v2026-01-11-SINGLE-SLOT+SPONSORED_GEOJSON");

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

/**
 * Attempt to extract a GeoJSON object from a sponsored_subscriptions row.
 *
 * Priority:
 *  1) final_geojson (already GeoJSON string/object)
 *  2) sponsored_geom_as_geojson (string from DB via ST_AsGeoJSON)
 */
function extractGeoJSONFromRow(r) {
  if (!r) return null;

  // final_geojson might be stored as JSON string OR object
  if (r.final_geojson) {
    try {
      return typeof r.final_geojson === "string"
        ? JSON.parse(r.final_geojson)
        : r.final_geojson;
    } catch {
      // if it's a string but not valid json, ignore
    }
  }

  if (r.sponsored_geom_as_geojson) {
    try {
      return typeof r.sponsored_geom_as_geojson === "string"
        ? JSON.parse(r.sponsored_geom_as_geojson)
        : r.sponsored_geom_as_geojson;
    } catch {
      return null;
    }
  }

  return null;
}

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
    body?.cleaner_id || body?.business_id || body?.cleanerId || null;

  const categoryId = body?.categoryId || null;

  // Allow caller to request specific slots, but default to [1]
  const slots =
    Array.isArray(body?.slots) && body.slots.length
      ? body.slots
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n))
      : DEFAULT_SLOTS;

  if (!areaIds.length) return json({ areas: [] });

  try {
    /**
     * We want:
     * - area_id, slot, status, business_id, created_at
     * - final_geojson (preferred)
     * - sponsored_geom_as_geojson (fallback) -> ST_AsGeoJSON(sponsored_geom)
     *
     * Supabase JS cannot call ST_AsGeoJSON directly in select() unless you expose it
     * via a VIEW or RPC. But you CAN select a computed column if it exists in a VIEW.
     *
     * ✅ Easiest approach: select final_geojson and sponsored_geom raw,
     * then separately fetch sponsored_geom as GeoJSON via an RPC.
     *
     * BUT to keep this file "drop-in", we will:
     * - select final_geojson
     * - select sponsored_geom (raw geom)
     * - and if final_geojson is missing, we'll call a tiny RPC to convert geom to geojson.
     *
     * If you already have a view exposing ST_AsGeoJSON(sponsored_geom) as
     * sponsored_geom_as_geojson, then this will also work by selecting that field.
     */

    // Pull all rows for these areas/slots (and category if provided)
    let q = supabase
      .from("sponsored_subscriptions")
      .select(
        [
          "id",
          "area_id",
          "slot",
          "status",
          "business_id",
          "created_at",
          "category_id",
          "final_geojson",
          // if you have a VIEW column with this name it will come through
          "sponsored_geom_as_geojson",
          // this may or may not be selectable depending on your column permissions/type
          "sponsored_geom",
        ].join(",")
      )
      .in("area_id", areaIds)
      .in("slot", slots);

    if (categoryId) q = q.eq("category_id", categoryId);

    const { data: rows, error } = await q;

    if (error) throw error;

    // Group by area:slot
    const byAreaSlot = new Map(); // key = `${area}:${slot}` -> array of rows
    for (const r of rows || []) {
      const k = `${r.area_id}:${r.slot}`;
      if (!byAreaSlot.has(k)) byAreaSlot.set(k, []);
      byAreaSlot.get(k).push(r);
    }

    // Helper: if we didn't get geojson but we have a geom, convert via RPC
    // You need this RPC in Supabase:
    //   create or replace function public.geom_to_geojson(g geometry)
    //   returns jsonb language sql immutable as $$
    //     select ST_AsGeoJSON($1)::jsonb;
    //   $$;
    //
    // If you DON'T have it yet, I’ll give you the exact SQL right after this file.
    async function ensureGeoJSON(chosenRow) {
      if (!chosenRow) return null;

      const already = extractGeoJSONFromRow(chosenRow);
      if (already) return already;

      // If no RPC exists / geom not selectable, we'll just return null.
      if (!chosenRow.sponsored_geom) return null;

      try {
        const { data, error } = await supabase.rpc("geom_to_geojson", {
          g: chosenRow.sponsored_geom,
        });
        if (error) return null;
        return data || null;
      } catch {
        return null;
      }
    }

    // Build response
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

        const taken =
          !!chosen && BLOCKING.has(String(status || "").toLowerCase());

        const taken_by_me =
          Boolean(cleaner_id) &&
          Boolean(owner_business_id) &&
          String(owner_business_id) === String(cleaner_id);

        // ✅ NEW: return sponsored_geojson for the chosen row
        const sponsored_geojson = taken ? await ensureGeoJSON(chosen) : null;

        areaObj.slots.push({
          slot,
          taken,
          taken_by_me,
          status,
          owner_business_id,
          sponsored_geojson, // ✅ frontend will render ONLY this fill
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
