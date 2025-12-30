// netlify/functions/billing-reminders.js
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

console.log("LOADED billing-reminders v2025-12-30-72H");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.INVOICE_FROM_EMAIL || "Kleanly <kleanly@nibing.uy>";
const SUBJECT = "Reminder: Your sponsorship renews in 72 hours";

// Run window: 72h ± 30 minutes (if running hourly)
// If you run daily, increase this window (e.g. ±12h)
const WINDOW_MINUTES = Number(process.env.BILLING_REMINDER_WINDOW_MINUTES || 30);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async (req) => {
  try {
    // Only allow cron (Netlify sets this header). Still allow manual trigger if you want.
    // if (!req.headers.get("x-nf-scheduled")) return json({ ok: false, error: "Not scheduled" }, 403);

    const now = new Date();
    const target = new Date(now.getTime() + 72 * 60 * 60 * 1000);

    const start = new Date(target.getTime() - WINDOW_MINUTES * 60 * 1000).toISOString();
    const end = new Date(target.getTime() + WINDOW_MINUTES * 60 * 1000).toISOString();

    // Find subscriptions renewing ~72h from now
    const { data: subs, error: subsErr } = await supabase
      .from("sponsored_subscriptions")
      .select("business_id, stripe_subscription_id, current_period_end, status, area_id, category_id, slot")
      .in("status", ["active", "trialing", "past_due"]) // choose what you want to remind
      .gte("current_period_end", start)
      .lte("current_period_end", end);

    if (subsErr) throw subsErr;

    let sent = 0;
    let skipped = 0;

    for (const sub of subs || []) {
      const subId = sub.stripe_subscription_id;
      if (!subId) {
        skipped++;
        continue;
      }

      // Idempotency: if already logged, skip
      const { data: already } = await supabase
        .from("billing_reminder_logs")
        .select("id")
        .eq("stripe_subscription_id", subId)
        .eq("reminder_type", "renewal_72h")
        .maybeSingle();

      if (already?.id) {
        skipped++;
        continue;
      }

      // Get business email
      const { data: cleaner, error: cleanerErr } = await supabase
        .from("cleaners")
        .select("business_name, contact_email")
        .eq("id", sub.business_id)
        .maybeSingle();

      if (cleanerErr) throw cleanerErr;

      const to = cleaner?.contact_email;
      if (!to) {
        skipped++;
        continue;
      }

      const businessName = cleaner?.business_name || "there";
      const periodEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
      const whenTxt = periodEnd ? periodEnd.toUTCString() : "soon";

      // Send email
      const resp = await resend.emails.send({
        from: FROM,
        to,
        subject: SUBJECT,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.5">
            <p>Hi ${businessName},</p>
            <p>This is a friendly reminder that your Featured Area sponsorship is scheduled to renew in <b>72 hours</b>.</p>
            <p><b>Renewal time (UTC):</b> ${whenTxt}</p>
            <p>If you need to update your billing details, please use the Billing section in your dashboard.</p>
            <p>Thanks,<br/>Kleanly</p>
          </div>
        `,
      });

      if (resp?.error) {
        console.warn("[billing-reminders] resend failed:", resp.error);
        // Don’t log as sent if email failed
        continue;
      }

      // Log as sent (idempotency)
      const { error: logErr } = await supabase.from("billing_reminder_logs").insert({
        stripe_subscription_id: subId,
        reminder_type: "renewal_72h",
        period_end: sub.current_period_end || null,
        sent_to: to,
      });

      if (logErr) {
        // Even if this fails, worst case you may send twice — but unique constraint protects most cases.
        console.warn("[billing-reminders] log insert failed:", logErr);
      }

      sent++;
    }

    return json({ ok: true, window: { start, end }, total: subs?.length || 0, sent, skipped });
  } catch (e) {
    console.error("[billing-reminders] fatal:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
