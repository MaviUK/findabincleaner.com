export default async (req, context) => {
  const url = new URL(req.url);
  const me = url.searchParams.get("me") || "demo";
  const slot = url.searchParams.get("slot") || "1";

  // Hatched area (pretend it's still available to buy)
  const fc = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { me, slot },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [-5.66, 54.675], [-5.605, 54.675],
            [-5.605, 54.645], [-5.66, 54.645],
            [-5.66, 54.675]
          ]]
        }
      }
    ]
  };

  return new Response(JSON.stringify(fc), {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
  });
};
