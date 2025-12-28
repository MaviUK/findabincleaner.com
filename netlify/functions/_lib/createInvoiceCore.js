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

/* ---------------- helpers ---------------- */

function supplierDetails() {
  return {
    name: process.env.INVOICE_SUPPLIER_NAME || "Find A Bin Cleaner Ltd",
    address: process.env.INVOICE_SUPPLIER_ADDRESS || "UK",
    email: process.env.INVOICE_SUPPLIER_EMAIL || "billing@findabincleaner.com",
    vat: process.env.INVOICE_SUPPLIER_VAT || "",
  };
}

function moneyGBP(cents) {
  return `£${(Number(cents || 0) / 100).toFixed(2)}`;
}

function isoDateFromUnix(ts) {
  if (!ts) return "";
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function safeUpperCurrency(c) {
  return String(c || "gbp").toUpperCase();
}

// Keep PDF text WinAnsi-safe (pdf-lib StandardFonts limitation)
function pdfSafeText(s) {
  if (s == null) return "";
  return String(s)
    .replaceAll("→", "to")
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .replaceAll("’", "'")
    .replaceAll("‘", "'")
    .replace(/[^\x09\x0A\x0D\x20-\x7E£]/g, "");
}

/* ---------------- PDF ---------------- */

async function renderPdf({
  invoiceNumber,
  supplier,
  customer,
  stripeRef,
  issueDateISO,
  periodStart,
  periodEnd,
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

  const left = 50;
  let y = 800;

  const draw = (text, size = 11, isBold = false) => {
    page.drawText(pdfSafeText(text), { x: left, y, size, font: isBold ? bold : font });
    y -= size + 6;
  };

  draw(supplier.name, 18, true);
  draw(supplier.address, 10, false);
  draw(supplier.email, 10, false);
  if (supplier.vat) draw(`VAT: ${supplier.vat}`, 10, false);

  y -= 10;
  draw("INVOICE", 16, true);
  draw(`Invoice #: ${invoiceNumber}`, 11, true);
  draw(`Issue date: ${issueDateISO}`, 11, false);
  draw(`Stripe ref: ${stripeRef}`, 10, false);

  y -= 12;
  draw("Billed to", 12, true);
  draw(customer.name || "Customer", 11, false);
  if (customer.address) draw(customer.address, 10, false);
  if (customer.email) draw(customer.email, 10, false);

  y -= 16;
  draw("Details", 12, true);
  if (headline) draw(headline, 11, false);
  if (periodStart && periodEnd) draw(`Billing period: ${periodStart} to ${periodEnd}`, 11, false);

  y -= 16;
  draw("Line items", 12, true);

  for (const l of lines || []) {
    draw(`${l.description}`, 10, true);
    draw(`Amount: ${moneyGBP(l.amount_cents)}`, 10, false);
    if (l.period_start && l.period_end) {
      draw(`Period: ${l.period_start} to ${l.period_end}`, 9, false);
    }
    y -= 6;
  }

  y -= 10;
  draw(`Subtotal: ${moneyGBP(subtotalCents)}`, 11, false);
  if (taxCents) draw(`Tax: ${moneyGBP(taxCents)}`, 11, false);
  draw(`Total: ${moneyGBP(totalCents)}`, 13, true);

  y = 70;
  page.drawText(pdfSafeText("Thank you for your business."), { x: left, y, size: 10, font });

  return Buffer.from(await pdfDoc.save());
}

/* ---------------- CORE ---------------- */

async function createInvoiceAndEmailByStripeInvoiceId(stripe_invoice_id) {
  console.log("[invoiceCore] start", stripe_invoice_id);

  const inv = await stripe.invoices.retrieve(stripe_invoice_id);

  // Dedupe: if invoice row exists and emailed => stop
  const { data: existingInvoice, error: existErr } = await supabase
    .from("invoices")
    .select("id, emailed_at, invoice_number")
    .eq("stripe_invoice_id", inv.id)
    .maybeSingle();

  if (existErr) {
    console.error("[invoiceCore] dedupe lookup error", existErr);
    throw existErr;
  }

  if (existingInvoice?.emailed_at) return "already-emailed";

  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

  const stripePaymentIntentId =
    typeof inv.payment_intent === "string" ? inv.payment_intent : inv.payment_intent?.id;

  if (!subscriptionId) return "no-subscription";

  const { data: subRow, error: subErr } = await supabase
    .from("sponsored_subscriptions")
    .select("id, business_id, area_id, current_period_end")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (subErr) {
    console.error("[invoiceCore] sponsored_subscriptions lookup error", subErr);
    throw subErr;
  }
  if (!subRow?.business_id) return "no-business-id";

  // ✅ contact_email is your real field
  const { data: cleaner, error: cleanerErr } = await supabase
    .from("cleaners")
    .select("business_name, contact_email, email, address")
    .eq("id", subRow.business_id)
    .maybeSingle();

  if (cleanerErr) {
    console.error("[invoiceCore] cleaners lookup error", cleanerErr);
    throw cleanerErr;
  }

  const customerEmail = cleaner?.contact_email || cleaner?.email || "";
  const customerName = cleaner?.business_name || "Customer";
  const customerAddress = cleaner?.address || "";

  if (!customerEmail) return "no-email";

  // Area info (name only; avoid area_km2 missing)
  let areaName = "Sponsored Area";
  const areaKm2 = 0;

  if (subRow.area_id) {
    const { data: area, error: areaErr } = await supabase
      .from("service_areas")
      .select("name")
      .eq("id", subRow.area_id)
      .maybeSingle();

    if (areaErr) console.warn("[invoiceCore] service_areas lookup error", areaErr);
    areaName = area?.name || areaName;
  }

  // Stripe amounts (includes proration)
  const subtotalCents = Number(inv.subtotal ?? 0);
  const totalCents = Number(inv.total ?? inv.amount_due ?? 0);
  const taxCents = Number(inv.tax ?? Math.max(0, totalCents - subtotalCents));

  // Invoice number
  const yyyy = new Date().getFullYear();
  const invoiceNumber =
    existingInvoice?.invoice_number || `INV-${yyyy}-${String(Date.now()).slice(-6)}`;

  const periodStart = inv.period_start
    ? isoDateFromUnix(inv.period_start)
    : new Date().toISOString().slice(0, 10);

  const periodEnd =
    (inv.period_end ? isoDateFromUnix(inv.period_end) : "") ||
    (subRow.current_period_end
      ? new Date(subRow.current_period_end).toISOString().slice(0, 10)
      : "");

  // Stripe line items
  const stripeLines = await stripe.invoices.listLineItems(inv.id, { limit: 100 });
  const lines = (stripeLines?.data || []).map((l) => ({
    stripe_line_id: l.id,
    description: l.description || l.price?.nickname || "Line item",
    amount_cents: Number(l.amount ?? 0),
    period_start: l.period?.start ? isoDateFromUnix(l.period.start) : "",
    period_end: l.period?.end ? isoDateFromUnix(l.period.end) : "",
    proration: Boolean(l.proration),
    quantity: Number(l.quantity ?? 1),
  }));

  // Create invoice row if needed
  let invoiceId = existingInvoice?.id || null;

  if (!invoiceId) {
    const supplier = supplierDetails();

    const { data: created, error: invErr } = await supabase
      .from("invoices")
      .insert({
        cleaner_id: subRow.business_id,
        area_id: subRow.area_id,
        stripe_invoice_id: inv.id,
        stripe_payment_intent_id: stripePaymentIntentId || null,
        invoice_number: invoiceNumber,
        status: inv.status || "open",
        subtotal_cents: subtotalCents,
        tax_cents: taxCents,
        total_cents: totalCents,
        currency: safeUpperCurrency(inv.currency),

        billing_period_start: periodStart,
        billing_period_end: periodEnd,

        supplier_name: supplier.name,
        supplier_address: supplier.address,
        supplier_email: supplier.email,
        supplier_vat: supplier.vat,

        customer_name: customerName,
        customer_email: customerEmail,
        customer_address: customerAddress,

        area_km2: areaKm2,
        rate_per_km2_cents: Math.round(Number(process.env.RATE_PER_KM2_PER_MONTH || "0") * 100),
      })
      .select("id")
      .maybeSingle();

    if (invErr) {
      console.error("[invoiceCore] insert invoices error", invErr);
      throw invErr;
    }

    invoiceId = created?.id || null;

    // Insert line items once
    if (invoiceId && lines.length) {
      const { error: liErr } = await supabase.from("invoice_line_items").insert(
        lines.map((l) => ({
          invoice_id: invoiceId,
          description: l.description,
          quantity: l.quantity,
          unit_price_cents: l.amount_cents,
          total_cents: l.amount_cents,
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

      if (liErr) {
        console.error("[invoiceCore] insert invoice_line_items error", liErr);
        throw liErr;
      }
    }
  }

  // Generate PDF
  const supplier = supplierDetails();
  const issueDateISO = new Date((inv.created || Math.floor(Date.now() / 1000)) * 1000)
    .toISOString()
    .slice(0, 10);

  const pdfBuffer = await renderPdf({
    invoiceNumber,
    supplier,
    customer: { name: customerName, email: customerEmail, address: customerAddress },
    stripeRef: inv.id,
    issueDateISO,
    periodStart,
    periodEnd,
    headline: `Sponsored area: ${areaName}`,
    lines,
    subtotalCents,
    taxCents,
    totalCents,
  });

  // ✅ IMPORTANT: allow override from env
  // For now set RESEND_FROM="onboarding@resend.dev" until you verify your domain
  const fromAddress =
    process.env.RESEND_FROM || `${supplier.name} <${supplier.email}>`;

  // Send email — and treat "error" as failure
  const resp = await resend.emails.send({
    from: fromAddress,
    to: customerEmail,
    subject: `Invoice ${invoiceNumber} - ${supplier.name}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5">
        <p>Hi ${pdfSafeText(customerName)},</p>
        <p>Attached is your invoice <b>${pdfSafeText(invoiceNumber)}</b>.</p>
        <p><b>${pdfSafeText(areaName)}</b></p>
        <p>Total: <b>${moneyGBP(totalCents)}</b></p>
        <p>Thanks,<br/>${pdfSafeText(supplier.name)}</p>
      </div>
    `,
    attachments: [
      {
        filename: `${invoiceNumber}.pdf`,
        content: pdfBuffer.toString("base64"),
      },
    ],
  });

  // Resend can return { data:null, error:{...} } without throwing
  if (resp?.error) {
    console.error("[invoiceCore] resend rejected:", resp);
    throw new Error(resp.error.message || "Resend rejected email");
  }

  console.log("[invoiceCore] resend sent:", resp);

  // Mark emailed
  if (invoiceId) {
    await supabase
      .from("invoices")
      .update({ emailed_at: new Date().toISOString() })
      .eq("id", invoiceId);
  }

  return existingInvoice?.id ? "emailed-existing" : "OK";
}

module.exports = { createInvoiceAndEmailByStripeInvoiceId };
