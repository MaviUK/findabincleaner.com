// netlify/functions/sendEnquiry.ts
import type { Handler } from "@netlify/functions";
import { Resend } from "resend";

/**
 * Required env vars in Netlify:
 * - RESEND_API_KEY            (your Resend key)
 * - ENQUIRY_FROM              (a verified sender, e.g. enquiries@yourdomain.com)
 * - ENQUIRY_INBOX_TO          (where to receive enquiries, e.g. you@yourdomain.com)
 */
const resend = new Resend(process.env.RESEND_API_KEY || "");

const allowOrigin = "*"; // tighten if you want

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed" });
  }

  // Basic CORS preflight (if you later add OPTIONS in Netlify)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: "",
    };
  }

  try {
    if (!process.env.RESEND_API_KEY || !process.env.ENQUIRY_FROM || !process.env.ENQUIRY_INBOX_TO) {
      return json(500, {
        error:
          "Email service not configured. Missing RESEND_API_KEY, ENQUIRY_FROM, or ENQUIRY_INBOX_TO.",
      });
    }

    const payload = JSON.parse(event.body || "{}") as {
      cleanerId: string;
      cleanerName: string;
      channels: ("email" | "whatsapp")[];
      name: string;
      address: string;
      phone: string;
      email: string;
      message: string;
    };

    // Minimal validation
    if (!payload.cleanerId || !payload.cleanerName) {
      return json(400, { error: "Missing cleanerId or cleanerName." });
    }
    if (!payload.name || !payload.message) {
      return json(400, { error: "Missing name or message." });
    }

    const subject = `New enquiry for ${payload.cleanerName}`;
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
        <h2>${escapeHtml(subject)}</h2>
        <p><strong>Cleaner:</strong> ${escapeHtml(payload.cleanerName)}<br/>
           <strong>Cleaner ID:</strong> ${escapeHtml(payload.cleanerId)}</p>
        <hr/>
        <p><strong>Name:</strong> ${escapeHtml(payload.name)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(payload.phone || "-")}</p>
        <p><strong>Email:</strong> ${escapeHtml(payload.email || "-")}</p>
        <p><strong>Address:</strong> ${escapeHtml(payload.address || "-")}</p>
        <p><strong>Message:</strong><br/>${escapeHtml(payload.message).replace(/\n/g, "<br/>")}</p>
        <hr/>
        <p style="color:#6b7280;font-size:12px">Sent from Find a Bin Cleaner</p>
      </div>
    `;

    // Send to your inbox (marketplace desk). You can bcc others if needed.
    const result = await resend.emails.send({
      from: process.env.ENQUIRY_FROM!,
      to: process.env.ENQUIRY_INBOX_TO!,
      subject,
      html,
      reply_to: payload.email || undefined, // lets you reply straight to the user
    });

    if ((result as any)?.error) {
      return json(500, { error: (result as any).error?.message || "Resend send failed." });
    }

    return json(200, { ok: true });
  } catch (e: any) {
    return json(500, { error: e?.message || "Unhandled error" });
  }
};

function json(status: number, body: unknown) {
  return {
    statusCode: status,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
