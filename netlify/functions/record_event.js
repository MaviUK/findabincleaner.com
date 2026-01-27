// netlify/functions/record_event.js
import { createClient } from "@supabase/supabase-js";

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return { statusCode: 500, body: "Missing Supabase env vars" };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const body = JSON.parse(event.body || "{}");

    // ✅ accept both snake_case (frontend) and camelCase (older callers)
    const cleaner_id = body.cleaner_id ?? body.cleanerId;
    const category_id = body.category_id ?? body.categoryId ?? null;
    const session_id = body.session_id ?? body.sessionId ?? null;

    // ⚠️ we will NOT trust this anymore (only fallback)
    const provided_area_id = body.area_id ?? body.areaId ?? null;

    const ev = body.event;
    const meta = body.meta ?? {};

    // Accept lat/lng in either naming style
    const latRaw = body.lat ?? body.latitude ?? body.userLat ?? null;
    const lngRaw = body.lng ?? body.longitude ?? body.userLng ?? null;

    const lat = latRaw == null ? null : Number(latRaw);
    const lng = lngRaw == null ? null : Number(lngRaw);

    if (!cleaner_id || !ev) {
      return { statusCode: 400, body: "Missing cleaner_id or event" };
    }

    // IMPORTANT: your DB uses a USER-DEFINED enum "event"
    const allowed = ["impression", "click_message", "click_phone", "click_website"];
    if (!allowed.includes(ev)) {
      return { statusCode: 400, body: "Invalid event" };
    }

    // ✅ Resolve correct area_id from polygons (preferred)
    // Only possible when we have cleaner_id + category_id + lat/lng
    let area_id = null;

    const hasLatLng = Number.isFinite(lat) && Number.isFinite(lng);
    const hasCategory = !!category_id;

    if (hasLatLng && hasCategory) {
      const { data, error: aErr } = await supabase.rpc("area_for_point", {
        p_cleaner_id: cleaner_id,
        p_category_id: category_id,
        p_lat: lat,
        p_lng: lng,
      });

      if (aErr) {
        console.warn("[record_event] area_for_point failed:", aErr);
        // fallback to provided area_id (older behaviour)
        area_id = provided_area_id;
      } else {
        area_id = data ?? null; // null means outside all polygons => unattributed
      }
    } else {
      // fallback for old callers that don't send lat/lng (or no category)
      area_id = provided_area_id;
    }

    const { error } = await supabase.from("analytics_events").insert({
      cleaner_id,
      area_id,
      category_id,
      session_id,
      event: ev,
      meta,
    });

    if (error) {
      console.error("analytics_events insert error:", error);
      return { statusCode: 500, body: error.message };
    }

    return { statusCode: 200, body: "ok" };
  } catch (e) {
    console.error("record_event error:", e);
    return { statusCode: 500, body: "Server error" };
  }
};
