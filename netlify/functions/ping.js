export default async () =>
  new Response(JSON.stringify({ pong: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
