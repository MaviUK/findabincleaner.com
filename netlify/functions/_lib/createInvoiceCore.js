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

function iso(ts) {
  return ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null;
}

/* ---------------- PDF ---------------- */

async function renderPdf({ invoiceNumber, supplier, customer, lines, totalCents }) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = 800;
  const left = 50;

  const draw = (t, s = 11, b = false) => {
    page.drawText(String(t), { x: left, y, size: s, font: b ? bold : font });
    y -= s + 6;
  };

  draw(supplier.name, 18, true);
  draw(supplier.address);
  draw(supplier.email);

  y -= 10;
  draw(`Invoice ${invoiceNumber}`, 14, true);

  y -= 10;
  draw(`Billed to: ${customer.name}`, 11, true);
  draw(customer.email);

  y -= 20;
  draw("Line items", 12, true);

  lines.forEach(l => {
    draw(l.description, 10, true);
    draw(moneyGBP(l.amount_cents), 10);
    y -= 6;
  });

  y -= 10;
  draw(`Total: ${moneyGBP(totalCents)}`, 14, true);

  return Buffer.from(await pdf.save());
}

/* ---------------- CORE ---------------- */

async function createInvoiceAndEmailByStripeInvoiceId(stripe_invoice_id) {
  console.log("[invoiceCore] start", stripe_invoice_id);

  const inv = await stripe.invoices.retrieve(stripe_invoice_id);

  const subscriptionId =
    typeof inv.subscription === "string"
      ? inv.subscription
      : inv.subscription?.id;

  if (!subscriptionId) return "no-subscription";

  const { data: subRow } = await supabase
    .from("sponsored_subscriptions")
    .select("business_id, area_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (!subRow?.business_id) return "no-business-id";

  /* 🔥 FIX: USE cleaners TABLE 🔥 */
  const { data: cleaner } = await supabase
    .from("cleaners")
    .select("business_name, email, address")
    .eq("id", subRow.business_id)
    .maybeSingle();

  if (!cleaner?.email) return "no-email";

  const linesResp = await stripe.invoices.listLineItems(inv.id, { limit: 100 });

  const lines = linesResp.data.map(l => ({
    description: l.description || "Subscription",
    amount_cents: l.amount,
  }));

  const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;

  const pdf = await renderPdf({
    invoiceNumber,
    supplier: supplierDetails(),
    customer: cleaner,
    lines,
    totalCents: inv.total,
  });

  /* ---------------- INSERT ---------------- */

  const { data: invoiceRow, error } = await supabase
    .from("invoices")
    .insert({
      cleaner_id: subRow.business_id,
      area_id: subRow.area_id,
      stripe_invoice_id: inv.id,
      stripe_payment_intent_id: inv.payment_intent,
      invoice_number: invoiceNumber,
      total_cents: inv.total,
      currency: inv.currency,
    })
    .select()
    .single();

  if (error) throw error;

  await resend.emails.send({
    from: "Find A Bin Cleaner <billing@findabincleaner.com>",
    to: cleaner.email,
    subject: `Invoice ${invoiceNumber}`,
    attachments: [{ filename: `${invoiceNumber}.pdf`, content: pdf.toString("base64") }],
    html: `<p>Your invoice is attached.</p>`,
  });

  return "OK";
}

module.exports = { createInvoiceAndEmailByStripeInvoiceId };
