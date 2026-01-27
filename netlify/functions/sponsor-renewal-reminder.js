export const config = {
  schedule: "@daily",
};

export default async function handler() {
  console.log("[reminder] ran sponsor-renewal-reminder");
  return {
    statusCode: 200,
    body: "ok",
  };
}
