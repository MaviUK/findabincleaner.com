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

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    const body = JSON.parse(event.body || "{}");

    // ✅ accept both snake_case (frontend) and camelCase (older callers)
    const cleaner_id = body.cleaner_id ?? body.cleanerId;
    const area_id = body.area_id ?? body.areaId ?? null;
    const category_id = body.category_id ?? body.categoryId ?? null;
    const session_id = body.session_id ?? body.sessionId ?? null;

    const ev = body.event;
    const meta = body.meta ?? {};

    if (!cleaner_id || !ev) {
      return { statusCode: 400, body: "Missing cleaner_id or event" };
    }

    // IMPORTANT: your DB uses a USER-DEFINED enum "event"
    const allowed = ["impression", "click_message", "click_phone", "click_website"];
    if (!allowed.includes(ev)) {
      return { statusCode: 400, body: "Invalid event" };
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
