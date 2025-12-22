// netlify/functions/record_event.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export async function handler(event) {
  // CORS
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    const cleaner_id = body.cleaner_id ?? null;
    const eventName = body.event ?? null;

    if (!cleaner_id || !eventName) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          ok: false,
          error: "Missing cleaner_id or event",
        }),
      };
    }

    const row = {
      cleaner_id,
      event: eventName,
      session_id: body.session_id ?? null,
      category_id: body.category_id ?? null,
      area_id: body.area_id ?? null,
      meta: body.meta ?? {},
    };

    const { error } = await supabase.from("analytics_events").insert(row);

    if (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ ok: false, error: error.message, row }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: String(e) }),
    };
  }
}
