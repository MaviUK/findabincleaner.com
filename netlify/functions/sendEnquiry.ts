import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

/**
 * Required Netlify env vars:
 *  - RESEND_API_KEY
 *  - ENQUIRY_FROM         (verified sender, e.g. enquiries@yourdomain.com)
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE
 *
 * Optional:
 *  - ENQUIRY_INBOX_TO     (admin BCC + fallback recipient if business email missing)
 *
 * What this function does:
 *  1) Looks up the business email via cleaners.contact_email
 *  2) Sends the enquiry to that business email (ONLY)
 *  3) Optionally BCCs ENQUIRY_INBOX_TO for admin visibility
 *  4) Sets reply_to so the business can reply directly to the sender
 */
const allowOrigin = "*";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE || ""
);

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

    const payload = JSON.parse(event.body || "{}") as {
      cleanerId: string;
      cleanerName: string;
      name: string;
      address: string;
      phone: string;
      email: string; // sender email
      message: string;
    };

    // Required checks (server-side enforcement)
    if (!payload.cleanerId || !payload.cleanerName) {
      return json(400, { error: "Missing cleanerId or cleanerName." });
    }
    if (!payload.name?.trim()) return json(400, { error: "Missing name." });
    if (!payload.address?.trim()) return json(400, { error: "Missing address." });
    if (!payload.phone?.trim()) return json(400, { error: "Missing phone." });
    if (!payload.email?.trim() || !isValidEmail(payload.email)) {
      return json(400, { error: "Missing or invalid email." });
    }
    if (!payload.message?.trim()) return json(400, { error: "Missing message." });

    // ✅ Resolve business email from cleaners.contact_email
    const businessEmail = await resolveCleanerContactEmail(payload.cleanerId);

    // Fallback recipient if business email isn't available:
    const primaryRecipient = businessEmail || ENQUIRY_INBOX_TO || "";
    if (!primaryRecipient) {
      return json(500, {
        error:
          "No recipient email available. Ensure cleaner has contact_email set or set ENQUIRY_INBOX_TO.",
      });
    }

    // ✅ ONLY send to business (no customer copy)
    const to = uniqueEmails([primaryRecipient]);

    // Optional admin copy (BCC) if ENQUIRY_INBOX_TO exists and isn't already in 'to'
    const bcc =
      ENQUIRY_INBOX_TO && !to.includes(ENQUIRY_INBOX_TO)
        ? [ENQUIRY_INBOX_TO]
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
      `<p style="color:#6b7280;font-size:12px">Sent from Clean.ly</p>` +
      `</div>`;

    // Send email via Resend
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
        reply_to: payload.email, // business can reply directly to sender
      }),
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return json(502, { error: txt || "Resend returned an error." });
    }

    return json(200, { ok: true, to, bcc: bcc || [] });
  } catch (e: any) {
    return json(500, { error: e?.message || "Unhandled error" });
  }
};

async function resolveCleanerContactEmail(cleanerId: string): Promise<string | null> {
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
    .replace(/>/g, "&lt;")
    .replace(/>/g, "&gt;");
}
