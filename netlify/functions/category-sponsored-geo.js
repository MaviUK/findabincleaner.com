const { createClient } = require("@supabase/supabase-js");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getAdmin() {
  const url = requireEnv("SUPABASE_URL");
  const key =
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;

  if (!key) throw new Error("Missing Supabase service role key env var");
  return createClient(url, key, { auth: { persistSession: false } });
}

exports.handler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { categoryId } = body || {};

    if (!categoryId) {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ features: [] }),
      };
    }

    const sb = getAdmin();

    const { data, error } = await sb
      .from("sponsored_subscriptions")
      .select("id, business_id, category_id, sponsored_geojson, status")
      .eq("category_id", categoryId)
      .in("status", ["active", "trialing", "past_due"])
      .not("sponsored_geojson", "is", null);

    if (error) throw error;

    const features = (data || []).map((r) => ({
      type: "Feature",
      properties: {
        sponsorship_id: r.id,
        owner_business_id: r.business_id,
        status: r.status,
      },
      geometry:
        typeof r.sponsored_geojson === "string"
          ? JSON.parse(r.sponsored_geojson)
          : r.sponsored_geojson,
    }));

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ features }),
    };
  } catch (e) {
    console.error("category-sponsored-geo error:", e);
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ features: [] }),
    };
  }
};
