// netlify/functions/createInvoiceAndEmail.js
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

  const draw = (text, size = 11, isBold = false) => {
    page.drawText(String(text || ""), { x: left, y, size, font: isBold ? bold : font });
    y -= size + 6;
  };

  const ensureSpace = (minY = 140) => {
    if (y < minY) newPage();
  };

  // Header
  draw(supplier.name, 18, true);
  draw(supplier.address, 10, false);
  draw(supplier.email, 10, false);
  if (supplier.vat) draw(`VAT: ${supplier.vat}`, 10, false);

  y -= 10;
  draw(`INVOICE`, 16, true);
  draw(`Invoice #: ${invoiceNumber}`, 11, true);
  draw(`Issue date: ${issueDateISO}`, 11, false);
  draw(`Stripe ref: ${stripeRef}`, 10, false);

  y -= 12;
  draw(`Billed to`, 12, true);
  draw(customer.name, 11, false);
  if (customer.address) draw(customer.address, 10, false);
  draw(customer.email, 10, false);

  y -= 16;
  draw(`Details`, 12, true);
  if (headline) draw(headline, 11, false);
  if (periodStart && periodEnd) draw(`Billing period: ${periodStart} → ${periodEnd}`, 11, false);

  y -= 16;
  draw(`Line items`, 12, true);

  for (const l of lines) {
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

exports.handler = async (event) => {
  try {
    const { stripe_invoice_id } = JSON.parse(event.body || "{}");
    if (!stripe_invoice_id) return { statusCode: 400, body: "Missing stripe_invoice_id" };

    // 1) Load Stripe invoice
    const inv = await stripe.invoices.retrieve(stripe_invoice_id);

    // ✅ DEDUPE
    const { data: existingInvoice, error: existErr } = await supabase
      .from("invoices")
      .select("id, emailed_at")
      .eq("stripe_invoice_id", inv.id)
      .maybeSingle();
    if (existErr) throw existErr;

    if (existingInvoice?.id) {
      return {
        statusCode: 200,
        body: existingInvoice.emailed_at
          ? "Already created & emailed"
          : "Already created (not emailed yet)",
      };
    }

    const subscriptionId =
      typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

    const stripePaymentIntentId =
      typeof inv.payment_intent === "string" ? inv.payment_intent : inv.payment_intent?.id;

    if (!subscriptionId) return { statusCode: 200, body: "No subscription on invoice." };

    // 2) Find your sponsored subscription row
    const { data: subRow, error: subErr } = await supabase
      .from("sponsored_subscriptions")
      .select("id, business_id, area_id, category_id, slot, current_period_end")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    if (subErr) throw subErr;
    if (!subRow?.business_id) return { statusCode: 404, body: "No business_id for subscription" };

    // 3) Load customer details
    const { data: cleaner, error: cleanerErr } = await supabase
      .from("cleaners")
      .select("business_name, email, address")
      .eq("id", subRow.business_id)
      .maybeSingle();
    if (cleanerErr) throw cleanerErr;
    if (!cleaner?.email) return { statusCode: 200, body: "Cleaner has no email saved." };

    // 4) Load area
    const { data: area, error: areaErr } = await supabase
      .from("service_areas")
      .select("name, area_km2")
      .eq("id", subRow.area_id)
      .maybeSingle();
    if (areaErr) throw areaErr;

    const areaName = area?.name || "Sponsored Area";
    const areaKm2 = Number(area?.area_km2 || 0);

    // 5) Rate snapshot (display/meta only; money should come from Stripe invoice)
    const ratePerKm2Cents = Math.round(
      Number(process.env.RATE_PER_KM2_PER_MONTH || "0") * 100
    );

    // ✅ 6) Amounts from Stripe (these reflect proration)
    const subtotalCents = Number(inv.subtotal ?? 0);
    const totalCents = Number(inv.total ?? inv.amount_due ?? 0);
    const taxCents = Number(inv.tax ?? Math.max(0, totalCents - subtotalCents));

    // 7) Invoice number
    const yyyy = new Date().getFullYear();
    const invoiceNumber = `INV-${yyyy}-${String(Date.now()).slice(-6)}`;

    // Period (invoice-level)
    const periodStart = isoDateFromUnix(inv.period_start) || new Date().toISOString().slice(0, 10);
    const periodEnd =
      isoDateFromUnix(inv.period_end) ||
      (subRow.current_period_end ? new Date(subRow.current_period_end).toISOString().slice(0, 10) : "");

    const supplier = supplierDetails();
    const customer = {
      name: cleaner.business_name || "Customer",
      email: cleaner.email,
      address: cleaner.address || "",
    };

    // ✅ 8) Pull Stripe line items (this is the real proration breakdown)
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

    // 9) Insert invoice row
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

    // 10) Insert invoice line items from Stripe
    if (lines.length) {
      await supabase.from("invoice_line_items").insert(
        lines.map((l) => ({
          invoice_id: createdInvoice.id,
          description: l.description,
          quantity: l.quantity,
          unit_price_cents: l.amount_cents, // simplest (you can split unit vs total later)
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
    }

    // 11) Generate PDF using Stripe lines
    const issueDateISO = new Date((inv.created || Math.floor(Date.now() / 1000)) * 1000)
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

    // 12) Store PDF
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

    // 13) Email
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
          ${signed?.signedUrl ? `<p>Download link (30 days): <a href="${signed.signedUrl}">View invoice</a></p>` : ""}
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

    // 14) Mark emailed
    await supabase
      .from("invoices")
      .update({
        pdf_storage_path: storagePath,
        pdf_signed_url: signed?.signedUrl || null,
        emailed_at: new Date().toISOString(),
      })
      .eq("id", createdInvoice.id);

    return { statusCode: 200, body: "OK" };
  } catch (e) {
    console.error("[createInvoiceAndEmail] error:", e);
    return { statusCode: 500, body: e?.message || "Server error" };
  }
};
