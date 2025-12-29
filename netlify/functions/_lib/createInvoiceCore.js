const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");
const { PDFDocument, StandardFonts } = require("pdf-lib");

// Node 18+ has global fetch
const fetchFn = global.fetch;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const resend = new Resend(process.env.RESEND_API_KEY);

/* ---------------- helpers ---------------- */

function supplierDetails() {
  // You said: send from Kleanly@nibing.uy
  // Make sure nibing.uy is verified in Resend, and this is an allowed sender.
  const fromEmail = process.env.INVOICE_FROM_EMAIL || "Kleanly <Kleanly@nibing.uy>";

  return {
    logoUrl: process.env.INVOICE_LOGO_URL || "", // optional: https://.../logo.png
    fromEmail,
    name: process.env.INVOICE_SUPPLIER_NAME || "Kleanly",
    address: process.env.INVOICE_SUPPLIER_ADDRESS || "UK",
    email: process.env.INVOICE_SUPPLIER_EMAIL || "Kleanly@nibing.uy",
    vat: process.env.INVOICE_SUPPLIER_VAT || ""
  };
}

function moneyGBP(cents) {
  return `£${(Number(cents || 0) / 100).toFixed(2)}`;
}

function isoDateFromUnix(ts) {
  return ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null;
}

function splitAddressLines(addr) {
  if (!addr) return [];
  return String(addr)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// pdf-lib standard fonts are WinAnsi — replace characters that can crash (like →)
function safeText(s) {
  return String(s ?? "")
    .replace(/\u2192/g, "->") // →
    .replace(/[^\x09\x0A\x0D\x20-\x7E£€©®™]/g, ""); // strip other unsupported chars
}

async function fetchLogoBytes(url) {
  if (!url) return null;
  if (!fetchFn) return null;
  try {
    const resp = await fetchFn(url);
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    return buf;
  } catch {
    return null;
  }
}

/* ---------------- PDF ---------------- */

async function renderPdf({
  invoiceNumber,
  supplier,
  customer,
  invoiceDate,
  billingPeriodStart,
  billingPeriodEnd,
  areaName,
  areaCoveredKm2,
  ratePerKm2Cents,
  lineAmountCents,
  vatCents,
  totalCents,
}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 48;
  const pageW = 595;
  const top = 842 - margin;

  // optional logo
  let logoImg = null;
  let logoDims = null;

  const logoBytes = await fetchLogoBytes(supplier.logoUrl);
  if (logoBytes) {
    try {
      // PNG preferred
      logoImg = await pdf.embedPng(logoBytes);
      const scale = 56 / logoImg.height; // ~56px tall
      logoDims = { w: logoImg.width * scale, h: logoImg.height * scale };
    } catch {
      logoImg = null;
      logoDims = null;
    }
  }

  // Header block
  const headerY = top;

  // Draw logo top-left
  let headerLeftX = margin;
  if (logoImg && logoDims) {
    page.drawImage(logoImg, {
      x: margin,
      y: headerY - logoDims.h,
      width: logoDims.w,
      height: logoDims.h,
    });
    headerLeftX = margin + logoDims.w + 12;
  }

  // Supplier name beside logo
  page.drawText(safeText(supplier.name), {
    x: headerLeftX,
    y: headerY - 18,
    size: 20,
    font: bold,
  });

  // Supplier address (split by commas)
  const addrLines = splitAddressLines(supplier.address);
  let y = headerY - 42;
  addrLines.forEach((ln) => {
    page.drawText(safeText(ln), { x: headerLeftX, y, size: 10.5, font });
    y -= 14;
  });

  // supplier email
  page.drawText(safeText(supplier.email), { x: headerLeftX, y, size: 10.5, font });
  y -= 14;

  // VAT (optional)
  if (supplier.vat) {
    page.drawText(`VAT: ${safeText(supplier.vat)}`, { x: headerLeftX, y, size: 10.5, font });
    y -= 14;
  }

  // Invoice meta (right side)
  const rightX = pageW - margin;
  const meta = [
    ["Invoice #", invoiceNumber],
    ["Invoice date", invoiceDate],
    ["Billing period", `${billingPeriodStart} to ${billingPeriodEnd}`],
  ];

  let metaY = headerY - 18;
  meta.forEach(([k, v]) => {
    const key = safeText(k);
    const val = safeText(v);
    const keyW = bold.widthOfTextAtSize(key, 10.5);
    const valW = font.widthOfTextAtSize(val, 10.5);

    // key on right, value aligned to the same right edge
    page.drawText(key, { x: rightX - keyW, y: metaY, size: 10.5, font: bold });
    metaY -= 14;
    page.drawText(val, { x: rightX - valW, y: metaY, size: 10.5, font });
    metaY -= 18;
  });

  // Divider line
  const dividerY = Math.min(y, metaY) - 12;
  page.drawLine({
    start: { x: margin, y: dividerY },
    end: { x: pageW - margin, y: dividerY },
    thickness: 1,
  });

  // Bill-to section
  let curY = dividerY - 22;
  page.drawText("Billed to", { x: margin, y: curY, size: 12, font: bold });
  curY -= 18;

  page.drawText(safeText(customer.name || "Customer"), { x: margin, y: curY, size: 11, font: bold });
  curY -= 14;

  if (customer.email) {
    page.drawText(safeText(customer.email), { x: margin, y: curY, size: 10.5, font });
    curY -= 14;
  }

  splitAddressLines(customer.address).forEach((ln) => {
    page.drawText(safeText(ln), { x: margin, y: curY, size: 10.5, font });
    curY -= 14;
  });

  // Table header
  curY -= 16;

  const col = {
    desc: margin,
    area: 320,
    rate: 420,
    amt: 510,
  };

  page.drawText("Description", { x: col.desc, y: curY, size: 10.5, font: bold });
  page.drawText("Area covered", { x: col.area, y: curY, size: 10.5, font: bold });
  page.drawText("Price per km²", { x: col.rate, y: curY, size: 10.5, font: bold });
  page.drawText("Amount", { x: col.amt, y: curY, size: 10.5, font: bold });

  curY -= 8;
  page.drawLine({
    start: { x: margin, y: curY },
    end: { x: pageW - margin, y: curY },
    thickness: 1,
  });
  curY -= 18;

  // Line item
  const desc = safeText(areaName || "Service area sponsorship");
  const areaTxt = `${Number(areaCoveredKm2 || 0).toFixed(3)} km²`;
  const rateTxt = moneyGBP(ratePerKm2Cents);
  const amtTxt = moneyGBP(lineAmountCents);

  page.drawText(desc, { x: col.desc, y: curY, size: 10.5, font });
  page.drawText(areaTxt, { x: col.area, y: curY, size: 10.5, font });
  page.drawText(rateTxt, { x: col.rate, y: curY, size: 10.5, font });
  page.drawText(amtTxt, { x: col.amt, y: curY, size: 10.5, font });

  // Totals
  curY -= 28;

  const totals = [
    ["Subtotal", lineAmountCents],
    ...(vatCents > 0 ? [["VAT", vatCents]] : []),
    ["Total", totalCents],
  ];

  let tY = curY;
  totals.forEach(([label, cents]) => {
    const l = safeText(label);
    const v = moneyGBP(cents);
    const lW = bold.widthOfTextAtSize(l, 11);
    const vW = bold.widthOfTextAtSize(v, 11);

    page.drawText(l, { x: rightX - 140 - lW, y: tY, size: 11, font: bold });
    page.drawText(v, { x: rightX - vW, y: tY, size: 11, font: bold });
    tY -= 16;
  });

  return Buffer.from(await pdf.save());
}

/* ---------------- CORE ---------------- */

async function createInvoiceAndEmailByStripeInvoiceId(stripe_invoice_id) {
  console.log("[invoiceCore] start", stripe_invoice_id);

  // Avoid duplicates: if we already created an invoice row for this stripe invoice, re-email it if needed
  const { data: existing } = await supabase
    .from("invoices")
    .select("id, invoice_number, customer_email, emailed_at")
    .eq("stripe_invoice_id", stripe_invoice_id)
    .maybeSingle();

  // Pull Stripe invoice
  const inv = await stripe.invoices.retrieve(stripe_invoice_id);

  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

  if (!subscriptionId) return "no-subscription";

  // Find your sponsored subscription row
  const { data: subRow } = await supabase
    .from("sponsored_subscriptions")
    .select("business_id, area_id, category_id, slot")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (!subRow?.business_id) return "no-business-id";

  // Pull cleaner info (you said email lives in contact_email)
  const { data: cleaner } = await supabase
    .from("cleaners")
    .select("business_name, contact_email, address")
    .eq("id", subRow.business_id)
    .maybeSingle();

  const customerEmail = cleaner?.contact_email || "";
  if (!customerEmail) return "no-email";

  // Area name + area km2 (do NOT rely on service_areas.area_km2 if it doesn’t exist)
  let areaName = "Service area sponsorship";
  let areaCoveredKm2 = 0;

  if (subRow.area_id) {
    const { data: area } = await supabase
      .from("service_areas")
      .select("name")
      .eq("id", subRow.area_id)
      .maybeSingle();

    if (area?.name) areaName = area.name;

    // If you have a correct km² stored elsewhere, use it.
    // Otherwise: best fallback is to derive from Stripe billing amount:
    // areaCoveredKm2 = amount / rate
    //
    // IMPORTANT: your “area covered wrong on invoice” issue is because this value
    // is being computed inconsistently across places. Best long-term fix:
    // store purchased_km2 at checkout-time into sponsored_subscriptions and read it here.
  }

  // Stripe line items (amounts are the source of truth for billing)
  const linesResp = await stripe.invoices.listLineItems(inv.id, { limit: 100 });
  const firstLine = linesResp.data?.[0];
  const lineAmountCents = Number(firstLine?.amount ?? inv.subtotal ?? inv.total ?? 0);

  // Rate used at checkout (your UI says £1.00 / km²)
  const ratePerKm2Cents = Number(process.env.RATE_PER_KM2_PER_MONTH_CENTS || 100); // £1.00 default

  // Fallback compute area from billing so invoice always matches billing:
  // area = amount / rate
  if (ratePerKm2Cents > 0) {
    areaCoveredKm2 = lineAmountCents / ratePerKm2Cents;
  }

  const vatCents = Number(inv.tax ?? 0);
  const totalCents = Number(inv.total ?? lineAmountCents + vatCents);

  // Invoice number
  const invoiceNumber =
    existing?.invoice_number ||
    `INV-${new Date().getUTCFullYear()}-${String(Date.now()).slice(-6)}`;

  const supplier = supplierDetails();

  // Dates
  const invoiceDate = isoDateFromUnix(inv.created) || new Date().toISOString().slice(0, 10);
  const billingPeriodStart = isoDateFromUnix(inv.period_start) || invoiceDate;
  const billingPeriodEnd = isoDateFromUnix(inv.period_end) || invoiceDate;

  // Build PDF
  const pdf = await renderPdf({
    invoiceNumber,
    supplier,
    customer: {
      name: cleaner?.business_name || "Customer",
      email: customerEmail,
      address: cleaner?.address || "",
    },
    invoiceDate,
    billingPeriodStart,
    billingPeriodEnd,
    areaName,
    areaCoveredKm2,
    ratePerKm2Cents,
    lineAmountCents,
    vatCents,
    totalCents,
  });

  // Insert invoice row if missing
  if (!existing?.id) {
    const { error } = await supabase.from("invoices").insert({
      cleaner_id: subRow.business_id,
      area_id: subRow.area_id,
      stripe_invoice_id: inv.id,
      stripe_payment_intent_id: inv.payment_intent || null,
      invoice_number: invoiceNumber,
      status: inv.status || "paid",
      subtotal_cents: Number(inv.subtotal ?? lineAmountCents),
      tax_cents: vatCents,
      total_cents: totalCents,
      currency: String(inv.currency || "gbp").toUpperCase(),
      billing_period_start: billingPeriodStart,
      billing_period_end: billingPeriodEnd,
      supplier_name: supplier.name,
      supplier_address: supplier.address,
      supplier_email: supplier.email,
      supplier_vat: supplier.vat,
      customer_name: cleaner?.business_name || "Customer",
      customer_email: customerEmail,
      customer_address: cleaner?.address || "",
      area_km2: Number(areaCoveredKm2 || 0),
      rate_per_km2_cents: ratePerKm2Cents,
    });

    if (error) throw error;
  }

  // Send email (even if existing)
  const sendResp = await resend.emails.send({
    from: supplier.fromEmail,
    to: customerEmail,
    subject: `Invoice ${invoiceNumber}`,
    attachments: [
      {
        filename: `${invoiceNumber}.pdf`,
        content: pdf.toString("base64"),
      },
    ],
    html: `<p>Your invoice is attached.</p>`,
  });

  console.log("[invoiceCore] resend response:", sendResp);

  // Mark emailed_at (best effort)
  await supabase
    .from("invoices")
    .update({ emailed_at: new Date().toISOString() })
    .eq("stripe_invoice_id", inv.id);

  // If resend failed, bubble a useful message to logs
  if (sendResp?.error) {
    return `email-error:${sendResp.error.message || "unknown"}`;
  }

  return existing?.id ? "emailed-existing" : "OK";
}

module.exports = { createInvoiceAndEmailByStripeInvoiceId };
