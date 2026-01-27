export const config = {
  schedule: "@hourly",
};

export default async function handler() {
  const msg = `REMINDER FUNCTION EXECUTED at ${new Date().toISOString()}`;

  return {
    statusCode: 200,
    headers: { "content-type": "text/plain" },
    body: msg,
  };
}
