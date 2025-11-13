// netlify/functions/sponsored-preview.js
// Minimal test handler: no imports, no Supabase, no Stripe.

exports.handler = async (event) => {
  console.log("[sponsored-preview] minimal handler invoked");

  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ok: true,
      message: "minimal sponsored-preview is alive",
      method: event.httpMethod,
    }),
  };
};
