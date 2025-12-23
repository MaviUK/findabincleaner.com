// netlify/functions/record_event.js
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export const handler = async (event) => {
  // CORS
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
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
    const body = JSON.parse(event.body || "{}");

    // expected payload
    const {
      event: ev,
      cleaner_id,
      category_id = null,
      area_id = null,
      session_id = null,
      meta = {},
      uniq = null,
    } = body;

    if (!ev || !cleaner_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing event or cleaner_id" }),
      };
    }

    const { error } = await supabaseAdmin.from("analytics_events").insert({
      event: ev,
      cleaner_id,
      category_id,
      area_id,
      session_id,
      meta,
      uniq,
    });

    if (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message }),
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e?.message || "Unknown error" }),
    };
  }
};
