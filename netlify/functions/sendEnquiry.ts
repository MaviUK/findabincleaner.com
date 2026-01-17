import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

/**
 * Required Netlify env vars:
 *  - RESEND_API_KEY
 *  - ENQUIRY_FROM         (must be on your verified domain, NOT onboarding@resend.dev)
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE
 *
 * Optional:
 *  - ENQUIRY_INBOX_TO     (admin BCC + fallback recipient if business email missing)
 *
 * Behaviour:
 *  - Stores enquiry in public.enquiries (including acknowledged flag)
 *  - Sends to business (cleaners.contact_email)
 *  - Sends a copy to the user (payload.email)
 *  - Optional BCC to ENQUIRY_INBOX_TO
 *  - Returns { ok: true } so UI can show "Sent!"
 */
const allowOrigin = "*";

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed" });
  }

  try {
    const {
      RESEND_API_KEY,
      ENQUIRY_FROM,
      ENQUIRY_INBOX_TO,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE,
    } = process.env;

    if (!RESEND_API_KEY || !ENQUIRY_FROM) {
      return json(500, {
        error:
          "Email service not configured. Missing RESEND_API_KEY or ENQUIRY_FROM.",
      });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return json(500, {
        error:
          "Database service not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE.",
      });
    }

    // ✅ Create Supabase client at runtime (env vars guaranteed)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const payload = JSON.parse(event.body || "{}") as {
      cleanerId: string;
      cleanerName: string;
      name: string;
      address: string;
      phone: string;
      email: string; // user email
      message: string;
      acknowledged?: boolean; // ✅ NEW
    };

    // Required checks
    if (!payload.cleanerId || !payload.cleanerName) {
      return json(400, { error: "Missing cleanerId or cleanerName." });
    }
    if (!payload.name?.trim()) return json(400, { error: "Missing name." });
    if (!payload.address?.trim())
      return json(400, { error: "Missing address." });
    if (!payload.phone?.trim()) return json(400, { error: "Missing phone." });
    if (!payload.email?.trim() || !isValidEmail(payload.email)) {
      return json(400, { error: "Missing or invalid email." });
    }
    if (!payload.message?.trim())
      return json(400, { error: "Missing message." });

    // ✅ Enforce acknowledgement server-side too
    if (!payload.acknowledged) {
      return json(400, {
        error: "You must confirm you have read and understood the information.",
      });
    }

    // Resolve business email from cleaners.contact_email
    const businessEmail = await resolveCleanerContactEmail(
      supabase,
      payload.cleanerId
    );

    // If no business email, fallback to ENQUIRY_INBOX_TO (admin)
    const primaryRecipient = businessEmail || ENQUIRY_INBOX_TO || "";
    if (!primaryRecipient) {
      return json(500, {
        error:
          "No recipient email available. Ensure cleaner has contact_email set or set ENQUIRY_INBOX_TO.",
      });
    }

    // ✅ Capture IP + user agent for abuse prevention / audit
    const ipRaw =
      event.headers["x-nf-client-connection-ip"] ||
      event.headers["x-forwarded-for"] ||
      event.headers["client-ip"] ||
      "";
    const ip =
      typeof ipRaw === "string" && ipRaw.trim()
        ? ipRaw.split(",")[0].trim()
        : null;

    const userAgent = (event.headers["user-agent"] || "").trim() || null;

    // ✅ Store enquiry in DB (NO marketing; enquiry only)
    const { error: insErr } = await supabase.from("enquiries").insert({
      cleaner_id: payload.cleanerId,
      user_name: payload.name.trim(),
      user_address: payload.address.trim(),
      user_phone: payload.phone.trim(),
      user_email: payload.email.trim().toLowerCase(),
      message: payload.message.trim(),
      ip,
      user_agent: userAgent,
      acknowledged: true, // we enforced it above
    });

    if (insErr) {
      console.error("[sendEnquiry] failed to store enquiry:", insErr);
      return json(500, { error: "Failed to store enquiry." });
    }

    // ✅ Send to business + send copy to user
    const to = uniqueEmails([primaryRecipient, payload.email]);

    // Optional admin BCC (only if not already included)
    const bcc =
      ENQUIRY_INBOX_TO && !to.includes(ENQUIRY_INBOX_TO.trim().toLowerCase())
        ? [ENQUIRY_INBOX_TO.trim().toLowerCase()]
        : undefined;

    const subject = `New enquiry for ${payload.cleanerName}`;

    const html =
      `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">` +
      `<h2>${esc(subject)}</h2>` +
      `<p><strong>Business:</strong> ${esc(payload.cleanerName)}<br/>` +
      `<strong>Cleaner ID:</strong> ${esc(payload.cleanerId)}</p>` +
      `<hr/>` +
      `<p><strong>Name:</strong> ${esc(payload.name)}</p>` +
      `<p><strong>Phone:</strong> ${esc(payload.phone)}</p>` +
      `<p><strong>Email:</strong> ${esc(payload.email)}</p>` +
      `<p><strong>Address:</strong> ${esc(payload.address)}</p>` +
      `<p><strong>Message:</strong><br/>${esc(payload.message).replace(
        /\n/g,
        "<br/>"
      )}</p>` +
      `<hr/>` +
      `<p style="color:#6b7280;font-size:12px">Sent from Klean.ly</p>` +
      `</div>`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ENQUIRY_FROM,
        to,
        bcc,
        subject,
        html,
        // ✅ When business replies, it goes to the user
        replyTo: payload.email,
      }),
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return json(502, { error: txt || "Resend returned an error." });
    }

    // UI uses this to show confirmation
    return json(200, {
      ok: true,
      stored: true,
      sent_to_business: !!businessEmail,
      recipients: to,
    });
  } catch (e: any) {
    return json(500, { error: e?.message || "Unhandled error" });
  }
};

async function resolveCleanerContactEmail(
  supabase: ReturnType<typeof createClient>,
  cleanerId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("cleaners")
    .select("contact_email")
    .eq("id", cleanerId)
    .maybeSingle();

  if (error) {
    console.error("[sendEnquiry] cleaners.contact_email lookup error:", error);
    return null;
  }

  const email = (data?.contact_email || "").trim();
  return email && isValidEmail(email) ? email : null;
}

function uniqueEmails(arr: string[]) {
  const out: string[] = [];
  for (const raw of arr) {
    const e = (raw || "").trim().toLowerCase();
    if (!e) continue;
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

function isValidEmail(v: string) {
  const s = (v || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function json(status: number, body: unknown) {
  return { statusCode: status, headers: cors(), body: JSON.stringify(body) };
}

function cors() {
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function esc(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
