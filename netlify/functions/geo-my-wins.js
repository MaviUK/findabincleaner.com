export default async (req, context) => {
  const url = new URL(req.url);
  const me = url.searchParams.get("me") || "demo";
  const slot = url.searchParams.get("slot") || "1";

  // Smaller box (pretend you currently hold #1 here)
  const fc = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { me, slot },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [-5.69, 54.68], [-5.63, 54.68],
            [-5.63, 54.655], [-5.69, 54.655],
            [-5.69, 54.68]
          ]]
        }
      }
    ]
  };

  return new Response(JSON.stringify(fc), {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
  });
};
