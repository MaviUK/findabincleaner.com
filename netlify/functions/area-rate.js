export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      rate_per_km2: Number(process.env.RATE_PER_KM2_PER_MONTH ?? 1.0),
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
};
