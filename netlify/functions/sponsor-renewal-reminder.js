import Stripe from "stripe";

export const config = {
  schedule: "@hourly", // keep hourly while testing
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

export default async function handler() {
  try {
    console.log("[reminder] job start");

    const subs = await stripe.subscriptions.list({
      status: "active",
      limit: 100,
    });

    let eligible = 0;
    for (const sub of subs.data) {
      // ✅ only those that will actually renew
      if (sub.status !== "active" && sub.status !== "trialing") continue;

      // ✅ skip ones that are set to cancel at period end
      if (sub.cancel_at_period_end) continue;

      eligible++;
    }

    console.log(
      `[reminder] stripe active subs=${subs.data.length} eligible_to_renew=${eligible}`
    );

    return { statusCode: 200, body: "ok" };
  } catch (err) {
    console.error("[reminder] failed", err);
    return { statusCode: 500, body: "error" };
  }
}
