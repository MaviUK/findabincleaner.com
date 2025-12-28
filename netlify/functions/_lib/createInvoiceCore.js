// netlify/functions/_lib/createInvoiceCore.js
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");
const { PDFDocument, StandardFonts } = require("pdf-lib");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const resend = new Resend(process.env.RESEND_API_KEY);

function supplierDetails() {
  return {
    name: process.env.INVOICE_SUPPLIER_NAME || "Find A Bin Cleaner Ltd",
    address: process.env.INVOICE_SUPPLIER_ADDRESS || "UK",
    email: process.env.INVOICE_SUPPLIER_EMAIL || "billing@findabincleaner.com",
    vat: process.env.INVOICE_SUPPLIER_VAT || "",
  };
}

function moneyGBP(cents) {
  const v = (Number(cents || 0) / 100).toFixed(2);
  return `£${v}`;
}

function isoDateFromUnix(ts) {
  if (!ts) return "";
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

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

  let page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const left = 50;
  let y = 800;

  const newPage = () => {
    page = pdfDoc.addPage([595.28, 841.89]);
    y = 800;
  };

  const ensureSpace = (minY = 140) => {
    if (y < minY) newPage();
  };

  const draw = (text, size = 11, isBold = false) => {
    page.drawText(String(text || ""), { x: left, y, size, font: isBold ? bold : font });
    y -= size + 6;
  };

  // Header
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
  draw(customer.name, 11, false);
  if (customer.address) draw(customer.address, 10, false);
  draw(customer.email, 10, false);

  y -= 16;
  draw("Details", 12, true);
  if (headline) draw(headline, 11, false);
  if (periodStart && periodEnd) draw(`Billing period: ${periodStart} → ${periodEnd}`, 11, false);

  y -= 16;
  draw("Line items", 12, true);

  for (const l of lines || []) {
    ensureSpace(170);
    const tag = l.proration ? " (proration)" : "";
    draw(`${l.description}${tag}`, 10, true);
    draw(`Amount: ${moneyGBP(l.amount_cents)}`, 10, false);
    if (l.period_start && l.period_end) {
      draw(`Period: ${l.period_start} → ${l.period_end}`, 9, false);
    }
    y -= 6;
  }

  ensureSpace(160);
  y -= 10;
  draw(`Subtotal: ${moneyGBP(subtotalCents)}`, 11, false);
  if (taxCents) draw(`Tax: ${moneyGBP(taxCents)}`, 11, false);
  draw(`Total: ${moneyGBP(totalCents)}`, 13, true);

  y = 70;
  page.drawText("Thank you for your business.", { x: left, y, size: 10, font });

  return Buffer.from(await pdfDoc.save());
}

async function loadCustomerByBusinessId(businessId) {
  const { data: cleaner, error: cleanerErr } = await supabase
    .from("cleaners")
    .select("business_name, email, address")
    .eq("id", businessId)
    .maybeSingle();
  if (cleanerErr) throw cleanerErr;
  if (cleaner?.email) {
    return {
      name: cleaner.business_name || "Customer",
      email: cleaner.email,
      address: cleaner.address || "",
      source: "cleaners",
    };
  }

  const { data: biz, error: bizErr } = await supabase
    .from("businesses")
    .select("name, email, address")
    .eq("id", businessId)
    .maybeSingle();
  if (bizErr) throw bizErr;
  if (biz?.email) {
    return {
      name: biz.name || "Customer",
      email: biz.email,
      address: biz.address || "",
      source: "businesses",
    };
  }

  return null;
}

async function createInvoiceAndEmailByStripeInvoiceId(stripe_invoice_id) {
  try {
    if (!stripe_invoice_id) return "Missing stripe_invoice_id";

    console.log("[invoiceCore] start", stripe_invoice_id);

    // 1) Stripe invoice
    const inv = await stripe.invoices.retrieve(stripe_invoice_id);

    // 2) Dedupe
    const { data: existingInvoice, error: existErr } = await supabase
      .from("invoices")
      .select("id, emailed_at, invoice_number")
      .eq("stripe_invoice_id", inv.id)
      .maybeSingle();

    if (existErr) throw existErr;

    if (existingInvoice?.id) {
      return existingInvoice.emailed_at
        ? `Already created & emailed (${existingInvoice.invoice_number || "invoice"})`
        : `Already created (not emailed yet) (${existingInvoice.invoice_number || "invoice"})`;
    }

    const subscriptionId =
      typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

    const stripePaymentIntentId =
      typeof inv.payment_intent === "string"
        ? inv.payment_intent
        : inv.payment_intent?.id;

    if (!subscriptionId) return "No subscription on invoice.";

    // 3) Find sponsored_subscriptions row
    const { data: subRow, error: subErr } = await supabase
      .from("sponsored_subscriptions")
      .select("id, business_id, area_id, category_id, slot, current_period_end")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    if (subErr) throw subErr;
    if (!subRow?.business_id) return "No business_id for subscription";
    if (!subRow?.area_id) return "No area_id for subscription";

    // 4) Customer
    const customer = await loadCustomerByBusinessId(subRow.business_id);
    if (!customer?.email) return "Customer has no email saved.";

    // 5) Area
    const { data: area, error: areaErr } = await supabase
      .from("service_areas")
      .select("name, area_km2")
      .eq("id", subRow.area_id)
      .maybeSingle();
    if (areaErr) throw areaErr;

    const areaName = area?.name || "Sponsored Area";
    const areaKm2 = Number(area?.area_km2 || 0);

    // 6) Stripe amounts
    const subtotalCents = Number(inv.subtotal ?? 0);
    const totalCents = Number(inv.total ?? inv.amount_due ?? 0);
    const taxCents = Number(inv.tax ?? 0);

    // 7) Invoice number
    const yyyy = new Date().getFullYear();
    const invoiceNumber = `INV-${yyyy}-${String(Date.now()).slice(-6)}`;

    const periodStart =
      isoDateFromUnix(inv.period_start) || new Date().toISOString().slice(0, 10);
    const periodEnd =
      isoDateFromUnix(inv.period_end) ||
      (subRow.current_period_end
        ? new Date(subRow.current_period_end).toISOString().slice(0, 10)
        : "");

    const supplier = supplierDetails();

    // 8) Rate snapshot for display/meta (not used for totals)
    const ratePerKm2Cents = Math.round(
      Number(process.env.RATE_PER_KM2_PER_MONTH || "0") * 100
    );

    // 9) Stripe line items
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

    console.log("[invoiceCore] inserting invoice row", inv.id, invoiceNumber);

    // 10) Insert invoice
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
        billing_period_start: periodStart,
        billing_period_end: periodEnd,
        supplier_name: supplier.name,
        supplier_address: supplier.address,
        supplier_email: supplier.email,
        supplier_vat: supplier.vat,
        customer_name: customer.name,
        customer_email: customer.email,
        customer_address: customer.address,
        area_km2: areaKm2,
        rate_per_km2_cents: ratePerKm2Cents,
      })
      .select("*")
      .maybeSingle();

    if (invErr) throw invErr;

    // 11) Insert line items
    if (lines.length) {
      const { error: liErr } = await supabase.from("invoice_line_items").insert(
        lines.map((l) => ({
          invoice_id: createdInvoice.id,
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
            rate_per_km2_cents: ratePerKm2Cents,
          },
        }))
      );
      if (liErr) throw liErr;
    }

    // 12) PDF
    const issueDateISO = new Date(
      (inv.created || Math.floor(Date.now() / 1000)) * 1000
    )
      .toISOString()
      .slice(0, 10);

    const pdfBuffer = await renderPdf({
      invoiceNumber,
      supplier,
      customer,
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

    // 13) Storage bucket name MUST exist
    const bucket = process.env.INVOICE_BUCKET || "invoices";
    const storagePath = `invoices/${subRow.business_id}/${invoiceNumber}.pdf`;

    console.log("[invoiceCore] uploading pdf", bucket, storagePath);

    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upErr) throw upErr;

    const { data: signed, error: signedErr } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 60 * 60 * 24 * 30);
    if (signedErr) throw signedErr;

    // 14) Email
    console.log("[invoiceCore] sending email", customer.email);

    await resend.emails.send({
      from: `${supplier.name} <${supplier.email}>`,
      to: customer.email,
      subject: `Invoice ${invoiceNumber} - ${supplier.name}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5">
          <p>Hi ${customer.name},</p>
          <p>Attached is your invoice <b>${invoiceNumber}</b>.</p>
          <p><b>${areaName}</b></p>
          <p>Total: <b>${moneyGBP(totalCents)}</b></p>
          ${
            signed?.signedUrl
              ? `<p>Download link (30 days): <a href="${signed.signedUrl}">View invoice</a></p>`
              : ""
          }
          <p>Thanks,<br/>${supplier.name}</p>
        </div>
      `,
      attachments: [
        {
          filename: `${invoiceNumber}.pdf`,
          content: pdfBuffer.toString("base64"),
        },
      ],
    });

    // 15) Mark emailed
    await supabase
      .from("invoices")
      .update({
        pdf_storage_path: storagePath,
        pdf_signed_url: signed?.signedUrl || null,
        emailed_at: new Date().toISOString(),
      })
      .eq("id", createdInvoice.id);

    console.log("[invoiceCore] done", inv.id, invoiceNumber);
    return "OK";
  } catch (err) {
    console.error("[invoiceCore] ERROR", stripe_invoice_id, err?.message || err, err?.stack || "");
    throw err; // let webhook log it
  }
}

module.exports = { createInvoiceAndEmailByStripeInvoiceId };
