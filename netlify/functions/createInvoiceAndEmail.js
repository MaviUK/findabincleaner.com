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

// Your “supplier” (marketplace) details (set these env vars in Netlify)
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

async function renderPdf({
  invoiceNumber,
  supplier,
  customer,
  areaName,
  periodStart,
  periodEnd,
  areaKm2,
  ratePerKm2Cents,
  totalCents,
  stripeRef,
}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 800;
  const left = 50;

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
  draw(`INVOICE`, 16, true);
  draw(`Invoice #: ${invoiceNumber}`, 11, true);
  draw(`Issue date: ${new Date().toLocaleDateString("en-GB")}`, 11, false);
  draw(`Stripe ref: ${stripeRef}`, 10, false);

  y -= 12;
  draw(`Billed to`, 12, true);
  draw(customer.name, 11, false);
  if (customer.address) draw(customer.address, 10, false);
  draw(customer.email, 10, false);

  y -= 16;
  draw(`Purchase details`, 12, true);
  draw(`Sponsored area: ${areaName}`, 11, false);
  draw(`Billing period: ${periodStart} → ${periodEnd}`, 11, false);

  y -= 16;
  draw(`Line item`, 12, true);
  draw(`Area size: ${Number(areaKm2).toFixed(2)} km²`, 11, false);
  draw(`Rate: ${moneyGBP(ratePerKm2Cents)} per km² / month`, 11, false);
  draw(`Total: ${moneyGBP(totalCents)}`, 13, true);

  // Footer
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
    const { data: cleaner } = await supabase
      .from("cleaners")
      .select("business_name, email, address")
      .eq("id", subRow.business_id)
      .maybeSingle();

    if (!cleaner?.email) return { statusCode: 200, body: "Cleaner has no email saved." };

    // 4) Load area name + km2 (adjust field names if yours differ)
    const { data: area } = await supabase
      .from("service_areas")
      .select("name, area_km2")
      .eq("id", subRow.area_id)
      .maybeSingle();

    const areaName = area?.name || "Sponsored Area";
    const areaKm2 = Number(area?.area_km2 || 0);

    // 5) Determine rate per km² (example: from env by tier/slot)
    // If you already have a pricing table, swap this logic to query it.
    const ratePerKm2Cents = Math.round(
      Number(process.env.RATE_PER_KM2_PER_MONTH || "0") * 100
    );

    const subtotalCents = Math.round(areaKm2 * ratePerKm2Cents);
    const totalCents = subtotalCents;

    // 6) Create invoice number (simple: INV-YYYY-xxxxx)
    const yyyy = new Date().getFullYear();
    const invoiceNumber = `INV-${yyyy}-${String(Date.now()).slice(-6)}`;

    // Billing period: use Stripe invoice period if present
    const periodStart = inv.period_start
      ? new Date(inv.period_start * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    const periodEnd = inv.period_end
      ? new Date(inv.period_end * 1000).toISOString().slice(0, 10)
      : subRow.current_period_end
      ? new Date(subRow.current_period_end).toISOString().slice(0, 10)
      : "";

    const supplier = supplierDetails();
    const customer = {
      name: cleaner.business_name || "Customer",
      email: cleaner.email,
      address: cleaner.address || "",
    };

    // 7) Insert invoice row
    const { data: createdInvoice, error: invErr } = await supabase
      .from("invoices")
      .insert({
        cleaner_id: subRow.business_id,
        area_id: subRow.area_id,
        stripe_invoice_id: inv.id,
        stripe_payment_intent_id: stripePaymentIntentId,
        invoice_number: invoiceNumber,
        status: inv.status || "paid",
        subtotal_cents: subtotalCents,
        tax_cents: 0,
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

    // 8) Insert line item
    await supabase.from("invoice_line_items").insert({
      invoice_id: createdInvoice.id,
      description: `Sponsored area: ${areaName} (${areaKm2.toFixed(2)} km² @ ${moneyGBP(
        ratePerKm2Cents
      )}/km²)`,
      quantity: 1,
      unit_price_cents: totalCents,
      total_cents: totalCents,
      meta: {
        area_name: areaName,
        area_km2: areaKm2,
        rate_per_km2_cents: ratePerKm2Cents,
        stripe_invoice_id: inv.id,
      },
    });

    // 9) Generate PDF
    const pdfBuffer = await renderPdf({
      invoiceNumber,
      supplier,
      customer,
      areaName,
      periodStart,
      periodEnd,
      areaKm2,
      ratePerKm2Cents,
      totalCents,
      stripeRef: inv.id,
    });

    // 10) Store PDF in Supabase Storage
    const storagePath = `invoices/${subRow.business_id}/${invoiceNumber}.pdf`;

    const { error: upErr } = await supabase.storage
      .from("invoices")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (upErr) throw upErr;

    const { data: signed } = await supabase.storage
      .from("invoices")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 30); // 30 days

    // 11) Email PDF
    await resend.emails.send({
      from: `${supplier.name} <${supplier.email}>`,
      to: customer.email,
      subject: `Invoice ${invoiceNumber} - ${supplier.name}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5">
          <p>Hi ${customer.name},</p>
          <p>Attached is your invoice <b>${invoiceNumber}</b> for your sponsored area purchase.</p>
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

    // 12) Mark invoice as stored + emailed
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
