const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const resend = new Resend(process.env.RESEND_API_KEY);

const HOURS_BEFORE = 72;

exports.handler = async () => {
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() + (HOURS_BEFORE - 1) * 3600_000); // 71h
    const windowEnd = new Date(now.getTime() + (HOURS_BEFORE + 1) * 3600_000);   // 73h

    // Find active subs renewing ~72h from now
    const { data: subs, error } = await supabase
      .from("sponsored_subscriptions")
      .select("business_id, area_id, stripe_subscription_id, current_period_end, status")
      .in("status", ["active", "trialing"])
      .gte("current_period_end", windowStart.toISOString())
      .lte("current_period_end", windowEnd.toISOString());

    if (error) throw error;
    if (!subs?.length) {
      return { statusCode: 200, body: "No renewals in 72h window." };
    }

    for (const s of subs) {
      if (!s.current_period_end || !s.stripe_subscription_id) continue;

      const renewalAtIso = new Date(s.current_period_end).toISOString();

      // Already sent?
      const { data: existing } = await supabase
        .from("renewal_notices")
        .select("id")
        .eq("stripe_subscription_id", s.stripe_subscription_id)
        .eq("notice_type", "72h")
        .eq("renewal_at", renewalAtIso)
        .maybeSingle();

      if (existing?.id) continue;

      // Get business email + name
      const { data: cleaner } = await supabase
        .from("cleaners")
        .select("business_name, email")
        .eq("id", s.business_id)
        .maybeSingle();

      const toEmail = cleaner?.email;
      if (!toEmail) continue;

      const businessName = cleaner?.business_name || "your business";

      await resend.emails.send({
        from: "Find A Bin Cleaner <billing@findabincleaner.com>",
        to: toEmail,
        subject: "Renewal notice: your sponsored area renews in 72 hours",
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.5">
            <h2>Renewal notice</h2>
            <p>Hi ${businessName},</p>
            <p>Your sponsorship is scheduled to renew on:</p>
            <p style="font-size:16px">
              <b>${new Date(renewalAtIso).toLocaleString("en-GB", { timeZone: "Europe/London" })}</b>
            </p>
            <p>No action is needed if you’d like it to continue.</p>
            <p>You can manage billing from your dashboard.</p>
          </div>
        `,
      });

      // Log notice (so we don't send again)
      await supabase.from("renewal_notices").insert({
        business_id: s.business_id,
        area_id: s.area_id,
        stripe_subscription_id: s.stripe_subscription_id,
        notice_type: "72h",
        renewal_at: renewalAtIso,
      });
    }

    return { statusCode: 200, body: `Processed ${subs.length} renewals.` };
  } catch (e) {
    console.error("[sendRenewalNotices] error:", e);
    return { statusCode: 500, body: e?.message || "Server error" };
  }
};
