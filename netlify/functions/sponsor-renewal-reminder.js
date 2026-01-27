import Stripe from "stripe";

export const config = {
  schedule: "@hourly", // keep hourly while testing
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

export default async function handler() {
  const now = Math.floor(Date.now() / 1000);
  const threeDays = 3 * 24 * 60 * 60;

  // 3 days from now ± 1 hour window
  const windowStart = now + threeDays - 3600;
  const windowEnd = now + threeDays + 3600;

  let matches = [];

  const subs = await stripe.subscriptions.list({
    status: "active",
    limit: 100,
  });

  for (const sub of subs.data) {
    // must actually renew
    if (sub.cancel_at_period_end) continue;

    const end = sub.current_period_end;

    if (end >= windowStart && end <= windowEnd) {
      matches.push({
        id: sub.id,
        renews_at: new Date(end * 1000).toISOString(),
      });
    }
  }

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      checked: subs.data.length,
      reminders_due: matches.length,
      matches,
    }),
  };
}
