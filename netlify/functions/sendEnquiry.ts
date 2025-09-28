import type { Handler } from "@netlify/functions";

/**
 * Required Netlify env vars:
 *  - RESEND_API_KEY
 *  - ENQUIRY_FROM         (verified sender, e.g. enquiries@yourdomain.com)
 *  - ENQUIRY_INBOX_TO     (where you want to receive enquiries)
 */
const allowOrigin = "*"; // tighten to your domain if you want

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed" });
  }

  try {
    const { RESEND_API_KEY, ENQUIRY_FROM, ENQUIRY_INBOX_TO } = process.env;
    if (!RESEND_API_KEY || !ENQUIRY_FROM || !ENQUIRY_INBOX_TO) {
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

    if (!payload.cleanerId || !payload.cleanerName) {
      return json(400, { error: "Missing cleanerId or cleanerName." });
    }
    if (!payload.name || !payload.message) {
      return json(400, { error: "Missing name or message." });
    }

    const subject = `New enquiry for ${payload.cleanerName}`;
    const html =
      `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">` +
      `<h2>${esc(subject)}</h2>` +
      `<p><strong>Cleaner:</strong> ${esc(payload.cleanerName)}<br/>` +
      `<strong>Cleaner ID:</strong> ${esc(payload.cleanerId)}</p>` +
      `<hr/>` +
      `<p><strong>Name:</strong> ${esc(payload.name)}</p>` +
      `<p><strong>Phone:</strong> ${esc(payload.phone || "-")}</p>` +
      `<p><strong>Email:</strong> ${esc(payload.email || "-")}</p>` +
      `<p><strong>Address:</strong> ${esc(payload.address || "-")}</p>` +
      `<p><strong>Message:</strong><br/>${esc(payload.message).replace(/\n/g, "<br/>")}</p>` +
      `<hr/><p style="color:#6b7280;font-size:12px">Sent from Find a Bin Cleaner</p>` +
      `</div>`;

    // Call Resend REST API directly
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ENQUIRY_FROM,
        to: ENQUIRY_INBOX_TO,
        subject,
        html,
        reply_to: payload.email || undefined,
      }),
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return json(502, { error: txt || "Resend returned an error." });
    }

    return json(200, { ok: true });
  } catch (e: any) {
    return json(500, { error: e?.message || "Unhandled error" });
  }
};

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
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
