// netlify/functions/sponsored-preview.cjs
// Minimal test handler: CommonJS (.cjs) so it works even with "type": "module"

exports.handler = async (event) => {
  console.log("[sponsored-preview] minimal CJS handler invoked");

  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ok: true,
      message: "minimal sponsored-preview is alive (CJS)",
      method: event.httpMethod,
    }),
  };
};
