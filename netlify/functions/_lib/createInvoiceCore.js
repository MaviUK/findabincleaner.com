// netlify/functions/_lib/createInvoiceCore.js
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");
const { PDFDocument, StandardFonts } = require("pdf-lib");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

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

function iso(ts) {
  return ts ? new Date(ts * 1000).toISOString().slice(0, 10) : "";
}

function safeStripeId(x) {
  return typeof x === "string" ? x : x?.id || null;
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
  lines,
  subtotalCents,
  taxCents,
  totalCents,
}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4-ish
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = 800;
  const left = 50;

  const draw = (t, s = 11, b = false) => {
    page.drawText(String(t ?? ""), { x: left, y, size: s, font: b ? bold : font });
    y -= s + 6;
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
  if (stripeRef) draw(`Stripe ref: ${stripeRef}`, 10, false);

  y -= 12;
  draw("Billed to", 12, true);
  draw(customer.name || "Customer", 11, false);
  if (customer.address) draw(customer.address, 10, false);
  draw(customer.email || "", 10, false);

  y -= 16;
  if (periodStart && periodEnd) {
    draw(`Billing period: ${periodStart} → ${periodEnd}`, 11, false);
    y -= 6;
  }

  draw("Line items", 12, true);

  for (const l of lines) {
    draw(l.description || "Line item", 10, true);
    draw(`Amount: ${moneyGBP(l.amount_cents)}`, 10, false);
    if (l.period_start && l.period_end) {
      draw(`Period: ${l.period_start} → ${l.period_end}`, 9, false);
    }
    y -= 6;
    if (y < 120) break; // keep it simple (avoid multi-page complexity)
  }

  y -= 10;
  draw(`Subtotal: ${moneyGBP(subtotalCents)}`, 11, false);
  if (taxCents) draw(`Tax: ${moneyGBP(taxCents)}`, 11, false);
  draw(`Total: ${moneyGBP(totalCents)}`, 13, true);

  y = 70;
  page.drawText("Thank you for your business.", { x: left, y, size: 10, font });

  return Buffer.from(await pdf.save());
}

/* ---------------- CORE ---------------- */

async function createInvoiceAndEmailByStripeInvoiceId(stripe_invoice_id) {
  console.log("[invoiceCore] start", stripe_invoice_id);

  // 0) Dedupe: if we already created our invoice for this Stripe invoice, do nothing
  const { data: existing, error: existErr } = await supabase
    .from("invoices")
    .select("id, emailed_at")
    .eq("stripe_invoice_id", stripe_invoice_id)
    .maybeSingle();

  if (existErr) throw existErr;

  if (existing?.id) {
    const msg = existing.emailed_at ? "Already created & emailed" : "Already created (not emailed yet)";
    console.log("[invoiceCore] dedupe:", stripe_invoice_id, msg);
    return msg;
  }

  // 1) Load Stripe invoice
  const inv = await stripe.invoices.retrieve(stripe_invoice_id);

  const subscriptionId = safeStripeId(inv.subscription);
  if (!subscriptionId) {
    console.warn("[invoiceCore] no subscription on invoice", inv.id);
    return "no-subscription";
  }

  // 2) Find your sponsored subscription row
  const { data: subRow, error: subErr } = await supabase
    .from("sponsored_subscriptions")
    .select("id, business_id, area_id, category_id, slot, current_period_end")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (subErr) throw subErr;

  if (!subRow?.business_id) {
    console.warn("[invoiceCore] no sponsored_subscriptions row for subscription", subscriptionId);
    return "no-business-id";
  }

  // 3) Load customer details (✅ cleaners table)
  const { data: cleaner, error: cleanerErr } = await supabase
    .from("cleaners")
    .select("business_name, email, address")
    .eq("id", subRow.business_id)
    .maybeSingle();

  if (cleanerErr) throw cleanerErr;

  if (!cleaner?.email) {
    console.warn("[invoiceCore] cleaner has no email", subRow.business_id);
    return "no-email";
  }

  // 4) Load area (optional – still useful for headline/meta)
  let areaName = "Sponsored Area";
  let areaKm2 = 0;

  if (subRow.area_id) {
    const { data: area, error: areaErr } = await supabase
      .from("service_areas")
      .select("name, area_km2")
      .eq("id", subRow.area_id)
      .maybeSingle();

    if (areaErr) throw areaErr;
    areaName = area?.name || areaName;
    areaKm2 = Number(area?.area_km2 || 0);
  }

  // 5) Stripe amounts (true proration)
  const subtotalCents = Number(inv.subtotal ?? 0);
  const totalCents = Number(inv.total ?? inv.amount_due ?? 0);
  const taxCents = Number(inv.tax ?? Math.max(0, totalCents - subtotalCents));

  const stripePaymentIntentId = safeStripeId(inv.payment_intent);

  // 6) Invoice number
  const yyyy = new Date().getFullYear();
  const invoiceNumber = `INV-${yyyy}-${String(Date.now()).slice(-6)}`;

  // 7) Billing period (invoice-level)
  const periodStart = inv.period_start ? iso(inv.period_start) : new Date().toISOString().slice(0, 10);
  const periodEnd =
    inv.period_end
      ? iso(inv.period_end)
      : subRow.current_period_end
      ? new Date(subRow.current_period_end).toISOString().slice(0, 10)
      : "";

  const issueDateISO = inv.created ? iso(inv.created) : new Date().toISOString().slice(0, 10);

  const supplier = supplierDetails();
  const customer = {
    name: cleaner.business_name || "Customer",
    email: cleaner.email,
    address: cleaner.address || "",
  };

  // 8) Pull Stripe line items
  const stripeLines = await stripe.invoices.listLineItems(inv.id, { limit: 100 });

  const lines = (stripeLines?.data || []).map((l) => ({
    stripe_line_id: l.id,
    description: l.description || l.price?.nickname || "Line item",
    amount_cents: Number(l.amount ?? 0),
    period_start: l.period?.start ? iso(l.period.start) : "",
    period_end: l.period?.end ? iso(l.period.end) : "",
    proration: Boolean(l.proration),
    quantity: Number(l.quantity ?? 1),
  }));

  // 9) Insert invoice row
  const ratePerKm2Cents = Math.round(
    Number(process.env.RATE_PER_KM2_PER_MONTH || "0") * 100
  );

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

  // 10) Insert invoice line items
  if (lines.length) {
    const { error: liErr } = await supabase.from("invoice_line_items").insert(
      lines.map((l) => ({
        invoice_id: createdInvoice.id,
        description: l.description,
        quantity: l.quantity,
        unit_price_cents: l.amount_cents, // simplest snapshot
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

  // 11) Generate PDF
  const pdfBuffer = await renderPdf({
    invoiceNumber,
    supplier,
    customer,
    stripeRef: inv.id,
    issueDateISO,
    periodStart,
    periodEnd,
    lines,
    subtotalCents,
    taxCents,
    totalCents,
  });

  // 12) Store PDF in Supabase Storage (optional, but recommended)
  const storagePath = `invoices/${subRow.business_id}/${invoiceNumber}.pdf`;

  const { error: upErr } = await supabase.storage
    .from("invoices")
    .upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (upErr) {
    // Don’t fail the entire invoice if storage is not set up yet
    console.warn("[invoiceCore] storage upload failed (continuing):", upErr?.message || upErr);
  }

  let signedUrl = null;
  try {
    const { data: signed, error: signedErr } = await supabase.storage
      .from("invoices")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 30);

    if (!signedErr) signedUrl = signed?.signedUrl || null;
  } catch (e) {
    // ignore
  }

  // 13) Email PDF
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
        ${signedUrl ? `<p>Download link (30 days): <a href="${signedUrl}">View invoice</a></p>` : ""}
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

  // 14) Mark emailed + paths
  const { error: updErr } = await supabase
    .from("invoices")
    .update({
      pdf_storage_path: upErr ? null : storagePath,
      pdf_signed_url: signedUrl,
      emailed_at: new Date().toISOString(),
    })
    .eq("id", createdInvoice.id);

  if (updErr) {
    console.warn("[invoiceCore] failed to update invoice emailed_at:", updErr?.message || updErr);
  }

  console.log("[invoiceCore] OK", stripe_invoice_id, invoiceNumber);
  return "OK";
}

module.exports = { createInvoiceAndEmailByStripeInvoiceId };
