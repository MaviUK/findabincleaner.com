// netlify/functions/record_event.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  // IMPORTANT: service role so inserts always work server-side
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  // Basic CORS
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "content-type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
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
        body: JSON.stringify({ error: "Missing cleaner_id or event" }),
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
        body: JSON.stringify({ error: error.message }),
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
      body: JSON.stringify({ error: e?.message || "Unknown error" }),
    };
  }
}
