// netlify/functions/sponsored-preview.cjs
// Minimal CommonJS handler just to prove the function runs at all

exports.handler = async (event) => {
  console.log("[sponsored-preview] minimal CJS handler invoked", {
    method: event.httpMethod,
    path: event.path,
  });

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
