export default async (req, context) => {
  const url = new URL(req.url);
  const me = url.searchParams.get("me") || "demo";

  // Simple square around Bangor (approx) — replace with your real coverage later.
  const fc = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { me },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [-5.725, 54.69], [-5.585, 54.69],
            [-5.585, 54.635], [-5.725, 54.635],
            [-5.725, 54.69]
          ]]
        }
      }
    ]
  };

  return new Response(JSON.stringify(fc), {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
  });
};
