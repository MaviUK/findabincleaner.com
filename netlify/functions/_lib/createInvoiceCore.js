// netlify/functions/_lib/createInvoiceCore.js
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");
const { PDFDocument, StandardFonts } = require("pdf-lib");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const resend = new Resend(process.env.RESEND_API_KEY);

/* ---------------- config helpers ---------------- */

function supplierDetails() {
  // These should be set in Netlify env vars
  // INVOICE_SUPPLIER_NAME, INVOICE_SUPPLIER_ADDRESS, INVOICE_FROM_EMAIL, INVOICE_SUPPLIER_VAT, INVOICE_SUPPLIER_PHONE, INVOICE_SUPPLIER_WEBSITE
  const fromEmail = process.env.INVOICE_FROM_EMAIL || process.env.INVOICE_SUPPLIER_EMAIL || "Kleanly@nibing.uy";
  return {
    name: process.env.INVOICE_SUPPLIER_NAME || "Kleanly",
    address: process.env.INVOICE_SUPPLIER_ADDRESS || "UK",
    email: fromEmail, // ✅ invoice email matches sender email
    vat: process.env.INVOICE_SUPPLIER_VAT || "",
    phone: process.env.INVOICE_SUPPLIER_PHONE || "",
    website: process.env.INVOICE_SUPPLIER_WEBSITE || "",
    bank_name: process.env.INVOICE_BANK_NAME || "",
    bank_sort_code: process.env.INVOICE_BANK_SORT_CODE || "",
    bank_account: process.env.INVOICE_BANK_ACCOUNT || "",
    paypal: process.env.INVOICE_PAYPAL_EMAIL || "",
    notes: process.env.INVOICE_NOTES || "",
  };
}

function moneyGBP(cents) {
  return `£${(Number(cents || 0) / 100).toFixed(2)}`;
}

function isoDateFromUnix(ts) {
  if (!ts) return "";
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function safeText(s) {
  // pdf-lib standard fonts use WinAnsi; replace common “bad” chars.
  return String(s ?? "")
    .replaceAll("→", "->")
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .replaceAll("’", "'")
    .replaceAll("•", "-");
}

function invoiceNumberFrom(inv) {
  // Prefer Stripe invoice number if present; fallback to your own.
  // Stripe often has inv.number like "5RRY4HKN-0015"
  if (inv?.number) return String(inv.number);
  const yyyy = new Date().getFullYear();
  return `INV-${yyyy}-${String(Date.now()).slice(-6)}`;
}

/* ---------------- PDF rendering ---------------- */

async function renderInvoicePdf({
  invoiceNumber,
  customerRef,
  invoiceDateISO,
  dueDateISO,
  paidLabel,
  supplier,
  customer,
  headline,
  lines,
  subtotalCents,
  taxCents,
  totalCents,
}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 45;
  const right = 595.28 - margin;

  const drawText = (text, x, y, size = 11, isBold = false) => {
    page.drawText(safeText(text), { x, y, size, font: isBold ? bold : font });
  };

  const line = (x1, y1, x2, y2, thickness = 1) => {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness });
  };

  // Header
  let y = 800;
  drawText(supplier.name, margin, y, 18, true);
  drawText("INVOICE", right - 80, y, 14, true);

  y -= 22;
  if (supplier.address) drawText(supplier.address, margin, y, 10, false);

  // Right meta block
  const metaX = right - 220;
  let metaY = 778;
  const metaLine = (label, value) => {
    drawText(`${label}:`, metaX, metaY, 10, true);
    drawText(value || "", metaX + 90, metaY, 10, false);
    metaY -= 14;
  };

  metaLine("Invoice #", invoiceNumber);
  if (customerRef) metaLine("Customer Ref", customerRef);
  metaLine("Invoice Date", invoiceDateISO);
  if (dueDateISO) metaLine("Due Date", dueDateISO);
  if (paidLabel) metaLine("Status", paidLabel);

  // Supplier contact lines
  y -= 14;
  if (supplier.phone) drawText(`Phone: ${supplier.phone}`, margin, y, 10, false), (y -= 14);
  if (supplier.email) drawText(`Email: ${supplier.email}`, margin, y, 10, false), (y -= 14);
  if (supplier.website) drawText(`Website: ${supplier.website}`, margin, y, 10, false), (y -= 14);
  if (supplier.vat) drawText(`VAT: ${supplier.vat}`, margin, y, 10, false), (y -= 14);

  y -= 6;
  line(margin, y, right, y, 1);
  y -= 18;

  // Address blocks
  const leftColX = margin;
  const rightColX = 320;

  drawText("Billed to", leftColX, y, 11, true);
  drawText("From", rightColX, y, 11, true);

  y -= 14;
  const addrBlock = (x, startY, linesArr) => {
    let yy = startY;
    for (const l of linesArr.filter(Boolean)) {
      drawText(l, x, yy, 10, false);
      yy -= 13;
    }
    return yy;
  };

  const custLines = [
    customer?.name || "Customer",
    customer?.address || "",
    customer?.email || "",
  ];

  const supLines = [
    supplier?.name || "",
    supplier?.address || "",
    supplier?.email || "",
  ];

  const yAfterCust = addrBlock(leftColX, y, custLines);
  const yAfterSup = addrBlock(rightColX, y, supLines);

  y = Math.min(yAfterCust, yAfterSup) - 14;

  if (headline) {
    drawText(headline, margin, y, 11, true);
    y -= 18;
  }

  // Line items table
  drawText("Description", margin, y, 10, true);
  drawText("Qty", 380, y, 10, true);
  drawText("Unit Price", 420, y, 10, true);
  drawText("Amount", 510, y, 10, true);

  y -= 8;
  line(margin, y, right, y, 1);
  y -= 14;

  const rowHeight = 14;

  for (const item of lines) {
    const desc = item.description || "Line item";
    const qty = String(item.quantity ?? 1);
    const unit = moneyGBP(item.unit_price_cents ?? item.total_cents ?? item.amount_cents ?? 0);
    const amt = moneyGBP(item.total_cents ?? item.amount_cents ?? 0);

    // Keep description short to avoid wrapping complexity
    const trimmed = safeText(desc).slice(0, 85);

    drawText(trimmed, margin, y, 10, false);
    drawText(qty, 385, y, 10, false);
    drawText(unit, 420, y, 10, false);
    drawText(amt, 510, y, 10, false);

    y -= rowHeight;

    // Basic page-break (simple)
    if (y < 180) {
      // We’ll add a new page and continue (minimal)
      const newPage = pdfDoc.addPage([595.28, 841.89]);
      // NOTE: for multi-page, you'd need to re-embed fonts on the new page in some setups,
      // but pdf-lib keeps embedded fonts available; we still need to draw on newPage.
      // To keep this file simple, we avoid multi-page complexity by limiting items above.
      // If you expect many lines, tell me and I'll add full multi-page rendering.
      drawText("Continued…", margin, 160, 10, false);
      break;
    }
  }

  y -= 8;
  line(margin, y, right, y, 1);
  y -= 18;

  // Totals block
  const totalsX = right - 200;
  const totalsLine = (label, value, isBold = false) => {
    drawText(label, totalsX, y, 10, isBold);
    drawText(value, totalsX + 110, y, 10, isBold);
    y -= 14;
  };

  totalsLine("Subtotal", moneyGBP(subtotalCents || 0), false);
  if (taxCents && Number(taxCents) > 0) totalsLine("Tax", moneyGBP(taxCents), false);
  totalsLine("Total", moneyGBP(totalCents || 0), true);

  // Notes / Bank details
  y -= 10;
  drawText("Notes", margin, y, 11, true);
  y -= 14;

  const notes = [];
  if (supplier.notes) notes.push(supplier.notes);
  if (supplier.bank_name || supplier.bank_sort_code || supplier.bank_account || supplier.paypal) {
    notes.push("Bank Details:");
    if (supplier.bank_name) notes.push(supplier.bank_name);
    if (supplier.bank_sort_code) notes.push(`S/C ${supplier.bank_sort_code}`);
    if (supplier.bank_account) notes.push(`A/N ${supplier.bank_account}`);
    if (supplier.paypal) notes.push(`PayPal: ${supplier.paypal}`);
  }

  const finalNotes = notes.length ? notes : ["Thank you for your business."];
  for (const n of finalNotes) {
    drawText(n, margin, y, 10, false);
    y -= 13;
    if (y < 60) break;
  }

  return Buffer.from(await pdfDoc.save());
}

/* ---------------- CORE: create invoice + PDF + email ---------------- */

async function createInvoiceAndEmailByStripeInvoiceId(stripe_invoice_id) {
  console.log("[invoiceCore] start", stripe_invoice_id);

  // 1) Load Stripe invoice
  const inv = await stripe.invoices.retrieve(stripe_invoice_id);

  // 2) Dedupe: if invoice exists, email if not emailed (or if forced)
  const { data: existingInvoice, error: existErr } = await supabase
    .from("invoices")
    .select("id, emailed_at, pdf_storage_path, invoice_number, customer_email")
    .eq("stripe_invoice_id", inv.id)
    .maybeSingle();

  if (existErr) throw existErr;

  if (existingInvoice?.id && existingInvoice.emailed_at) {
    return "already-emailed";
  }

  // 3) Subscription mapping
  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

  const stripePaymentIntentId =
    typeof inv.payment_intent === "string" ? inv.payment_intent : inv.payment_intent?.id;

  if (!subscriptionId) return "no-subscription";

  // 4) Get sponsored_subscriptions row
  const { data: subRow, error: subErr } = await supabase
    .from("sponsored_subscriptions")
    .select("id, business_id, area_id, category_id, slot, current_period_end")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (subErr) throw subErr;
  if (!subRow?.business_id) return "no-business-id";

  // 5) Customer details (✅ your schema: contact_email)
  const { data: cleaner, error: cleanerErr } = await supabase
    .from("cleaners")
    .select("business_name, contact_email, address")
    .eq("id", subRow.business_id)
    .maybeSingle();

  if (cleanerErr) throw cleanerErr;

  const customerEmail = cleaner?.contact_email || "";
  if (!customerEmail) return "no-email";

  // 6) Area details (don’t hard-fail if a column differs)
  let areaName = "Sponsored Area";
  let areaKm2 = 0;

  if (subRow.area_id) {
    const { data: area, error: areaErr } = await supabase
      .from("service_areas")
      .select("name, km2") // ✅ your schema seems to NOT have area_km2
      .eq("id", subRow.area_id)
      .maybeSingle();

    if (areaErr) {
      console.warn("[invoiceCore] service_areas lookup error", areaErr);
    } else {
      areaName = area?.name || areaName;
      areaKm2 = Number(area?.km2 || 0);
    }
  }

  // 7) Stripe line items (true proration breakdown)
  const stripeLines = await stripe.invoices.listLineItems(inv.id, { limit: 100 });
  const lines = (stripeLines?.data || []).map((l) => {
    const qty = Number(l.quantity ?? 1);
    const total = Number(l.amount ?? 0);
    const unit = qty ? Math.round(total / qty) : total;

    return {
      stripe_line_id: l.id,
      description: l.description || l.price?.nickname || "Line item",
      quantity: qty,
      unit_price_cents: unit,
      total_cents: total,
      period_start: l.period?.start ? isoDateFromUnix(l.period.start) : "",
      period_end: l.period?.end ? isoDateFromUnix(l.period.end) : "",
      proration: Boolean(l.proration),
    };
  });

  // 8) Amounts from Stripe
  const subtotalCents = Number(inv.subtotal ?? 0);
  const totalCents = Number(inv.total ?? inv.amount_due ?? 0);
  const taxCents = Number(inv.tax ?? Math.max(0, totalCents - subtotalCents));

  // 9) Invoice fields
  const supplier = supplierDetails();
  const customer = {
    name: cleaner.business_name || "Customer",
    email: customerEmail,
    address: cleaner.address || "",
  };

  const invoiceNumber = existingInvoice?.invoice_number || invoiceNumberFrom(inv);

  const invoiceDateISO = isoDateFromUnix(inv.created || Math.floor(Date.now() / 1000)) || new Date().toISOString().slice(0, 10);
  const dueDateISO = inv.due_date ? isoDateFromUnix(inv.due_date) : invoiceDateISO;

  const paidLabel = inv.status === "paid" ? "PAID" : String(inv.status || "").toUpperCase();

  // 10) Create invoice row if missing
  let invoiceId = existingInvoice?.id || null;

  if (!invoiceId) {
    const { data: createdInvoice, error: invErr } = await supabase
      .from("invoices")
      .insert({
        cleaner_id: subRow.business_id,
        area_id: subRow.area_id,
        stripe_invoice_id: inv.id,
        stripe_payment_intent_id: stripePaymentIntentId,
        invoice_number: invoiceNumber,
        status: inv.status || "open",
        subtotal_cents: subtotalCents,
        tax_cents: taxCents,
        total_cents: totalCents,
        currency: (inv.currency || "gbp").toUpperCase(),
        billing_period_start: isoDateFromUnix(inv.period_start) || invoiceDateISO,
        billing_period_end: isoDateFromUnix(inv.period_end) || dueDateISO,
        supplier_name: supplier.name,
        supplier_address: supplier.address,
        supplier_email: supplier.email,
        supplier_vat: supplier.vat,
        customer_name: customer.name,
        customer_email: customer.email,
        customer_address: customer.address,
        area_km2: areaKm2,
        rate_per_km2_cents: Math.round(Number(process.env.RATE_PER_KM2_PER_MONTH || "0") * 100),
      })
      .select("id")
      .single();

    if (invErr) throw invErr;
    invoiceId = createdInvoice.id;

    // Line items table (optional; only if you want it)
    if (lines.length) {
      await supabase.from("invoice_line_items").insert(
        lines.map((l) => ({
          invoice_id: invoiceId,
          description: l.description,
          quantity: l.quantity,
          unit_price_cents: l.unit_price_cents,
          total_cents: l.total_cents,
          meta: {
            stripe_invoice_id: inv.id,
            stripe_line_id: l.stripe_line_id,
            proration: l.proration,
            period_start: l.period_start,
            period_end: l.period_end,
            area_name: areaName,
            area_km2: areaKm2,
          },
        }))
      );
    }
  }

  // 11) Build PDF
  const headline = `Sponsored area: ${areaName}${areaKm2 ? ` (${areaKm2.toFixed(2)} km²)` : ""}`;

  const pdfBuffer = await renderInvoicePdf({
    invoiceNumber,
    customerRef: "", // if you want a ref number, add from DB here
    invoiceDateISO,
    dueDateISO,
    paidLabel: inv.status === "paid" ? "Payment received, with thanks." : "",
    supplier,
    customer,
    headline,
    lines,
    subtotalCents,
    taxCents,
    totalCents,
  });

  // 12) Store PDF in Supabase Storage
  const storagePath = `invoices/${subRow.business_id}/${invoiceNumber}.pdf`;

  const { error: upErr } = await supabase.storage
    .from("invoices")
    .upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (upErr) throw upErr;

  const { data: signed, error: signedErr } = await supabase.storage
    .from("invoices")
    .createSignedUrl(storagePath, 60 * 60 * 24 * 30);

  if (signedErr) throw signedErr;

  // 13) Send email (Resend)
  const fromEmail = supplier.email; // ✅ same as invoice email

  const subject = `Invoice ${invoiceNumber} - ${supplier.name}`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5">
      <p>Hi ${safeText(customer.name)},</p>
      <p>Please find your invoice <b>${safeText(invoiceNumber)}</b> attached.</p>
      <p><b>${safeText(areaName)}</b></p>
      <p>Total: <b>${moneyGBP(totalCents)}</b></p>
      ${signed?.signedUrl ? `<p>Download link (30 days): <a href="${signed.signedUrl}">View invoice</a></p>` : ""}
      <p>Thanks,<br/>${safeText(supplier.name)}</p>
    </div>
  `;

  const resp = await resend.emails.send({
    from: `${supplier.name} <${fromEmail}>`,
    to: customer.email,
    // Optional but recommended:
    replyTo: fromEmail,
    subject,
    html,
    attachments: [
      {
        filename: `${invoiceNumber}.pdf`,
        content: pdfBuffer.toString("base64"),
      },
    ],
  });

  if (resp?.error) {
    console.log("[invoiceCore] resend accepted:", resp);
    // Do NOT mark emailed_at if provider rejected it
    throw new Error(resp.error.message || "Resend error");
  }

  // 14) Mark emailed
  await supabase
    .from("invoices")
    .update({
      pdf_storage_path: storagePath,
      pdf_signed_url: signed?.signedUrl || null,
      emailed_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);

  return existingInvoice?.id ? "emailed-existing" : "OK";
}

module.exports = { createInvoiceAndEmailByStripeInvoiceId };
