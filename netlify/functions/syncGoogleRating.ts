import type { Handler } from "@netlify/functions";

export const handler: Handler = async (event) => {
  try {
    const { cleaner_id } = JSON.parse(event.body || "{}");
    if (!cleaner_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing cleaner_id" }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL!;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY!;

    // 1) load cleaner row to get place id
    const cleanerRes = await fetch(`${SUPABASE_URL}/rest/v1/cleaners?id=eq.${cleaner_id}&select=id,google_place_id`, {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
    });

    const cleanerRows = await cleanerRes.json();
    const row = cleanerRows?.[0];
    if (!row?.google_place_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "No google_place_id set" }) };
    }

    // 2) fetch rating from Google Place Details
    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.set("place_id", row.google_place_id);
    url.searchParams.set("fields", "rating,user_ratings_total");
    url.searchParams.set("key", GOOGLE_KEY);

    const googleRes = await fetch(url.toString());
    const googleJson = await googleRes.json();

    if (googleJson.status !== "OK") {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Google error", details: googleJson }),
      };
    }

    const rating = googleJson.result?.rating ?? null;
    const count = googleJson.result?.user_ratings_total ?? null;

    // 3) write into cleaners table
    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/cleaners?id=eq.${cleaner_id}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        google_rating: rating,
        google_reviews_count: count,
        google_last_synced: new Date().toISOString(),
      }),
    });

    const updated = await updateRes.json();

    return { statusCode: 200, body: JSON.stringify({ ok: true, rating, count, updated }) };
  } catch (e: any) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || "Server error" }) };
  }
};
