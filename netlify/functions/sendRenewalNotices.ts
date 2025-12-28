import type { Handler } from "@netlify/functions";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

const HOURS_BEFORE = 72;

export const handler: Handler = async () => {
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() + (HOURS_BEFORE - 1) * 60 * 60 * 1000); // 71h
    const windowEnd = new Date(now.getTime() + (HOURS_BEFORE + 1) * 60 * 60 * 1000);   // 73h

    // 1) Pull active sponsorships that renew around ~72 hours from now
    // Adjust table/fields to match your schema:
    const { data: sponsorships, error } = await supabase
      .from("area_sponsorships")
      .select("cleaner_id, area_id, stripe_subscription_id, status, current_period_end")
      .eq("status", "active")
      .gte("current_period_end", windowStart.toISOString())
      .lte("current_period_end", windowEnd.toISOString());

    if (error) throw error;
    if (!sponsorships?.length) {
      return { statusCode: 200, body: "No renewals in 72h window." };
    }

    for (const s of sponsorships) {
      const renewalAt = new Date(s.current_period_end).toISOString();

      // 2) Check if we already sent the 72h notice for this renewal
      const { data: existing } = await supabase
        .from("renewal_notices")
        .select("id")
        .eq("stripe_subscription_id", s.stripe_subscription_id)
        .eq("notice_type", "72h")
        .eq("renewal_at", renewalAt)
        .maybeSingle();

      if (existing?.id) continue;

      // 3) Fetch details for email content
      const [sub, cleanerRow, areaRow] = await Promise.all([
        stripe.subscriptions.retrieve(s.stripe_subscription_id),
        supabase.from("cleaners").select("business_name, email").eq("id", s.cleaner_id).maybeSingle(),
        supabase.from("service_areas").select("name").eq("id", s.area_id).maybeSingle(),
      ]);

      const cleanerEmail = cleanerRow.data?.email;
      if (!cleanerEmail) continue;

      const businessName = cleanerRow.data?.business_name ?? "Your business";
      const areaName = areaRow.data?.name ?? "your sponsored area";

      // Stripe gives “upcoming invoice” amounts via upcoming invoice endpoint
      // This is best for “what you’ll be charged”
      let upcomingAmountText = "";
      try {
        const upcoming = await stripe.invoices.retrieveUpcoming({
          customer: sub.customer as string,
          subscription: sub.id,
        });
        const total = upcoming.total ?? 0;
        const currency = (upcoming.currency ?? "gbp").toUpperCase();
        upcomingAmountText = `Estimated renewal charge: ${(total / 100).toFixed(2)} ${currency}`;
      } catch {
        // Not fatal if upcoming invoice isn't available
        upcomingAmountText = "";
      }

      // 4) Send email
      await resend.emails.send({
        from: "Find A Bin Cleaner <billing@findabincleaner.com>",
        to: cleanerEmail,
        subject: `Renewal notice: ${areaName} renews in 72 hours`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.5">
            <h2>Renewal notice</h2>
            <p>Hi ${businessName},</p>
            <p>Your sponsored listing for <b>${areaName}</b> is scheduled to renew on:</p>
            <p style="font-size:16px"><b>${new Date(renewalAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}</b></p>
            ${upcomingAmountText ? `<p>${upcomingAmountText}</p>` : ""}
            <p>No action is needed if you’d like it to continue.</p>
            <p>If you want to change or cancel your sponsorship, you can do so from your dashboard billing section.</p>
            <p>Thanks,<br/>Find A Bin Cleaner</p>
          </div>
        `,
      });

      // 5) Record notice so it won't resend
      await supabase.from("renewal_notices").insert({
        cleaner_id: s.cleaner_id,
        area_id: s.area_id,
        stripe_subscription_id: s.stripe_subscription_id,
        notice_type: "72h",
        renewal_at: renewalAt,
      });
    }

    return { statusCode: 200, body: `Processed ${sponsorships.length} renewals.` };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message ?? "Error" };
  }
};
