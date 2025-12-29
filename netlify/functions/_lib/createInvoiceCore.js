// netlify/functions/_lib/createInvoiceCore.js
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");
const { PDFDocument, StandardFonts } = require("pdf-lib");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const resend = new Resend(process.env.RESEND_API_KEY);

/* ---------------- helpers ---------------- */

function supplierDetails() {
  return {
    name: process.env.INVOICE_SUPPLIER_NAME || "Kleanly",
    // You asked for address line breaks after commas: we'll apply in PDF rendering too
    address:
      process.env.INVOICE_SUPPLIER_ADDRESS ||
      "78 Groomsport Rd, Bangor BT20 5NF, UK",
    email: process.env.INVOICE_SUPPLIER_EMAIL || "kleanly@nibing.uy",
    vat: process.env.INVOICE_SUPPLIER_VAT || "",
  };
}

function moneyGBP(cents) {
  return `£${(Number(cents || 0) / 100).toFixed(2)}`;
}

function iso(ts) {
  return ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null;
}

function safeText(s) {
  // pdf-lib StandardFonts uses WinAnsi; strip/replace characters it can't encode
  return String(s ?? "")
    .replace(/[→]/g, "->")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function splitAddressLines(addr) {
  return safeText(addr)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function fetchLogoBytes() {
  // Expect a publicly accessible PNG URL (recommended) or skip if not set
  const url = process.env.INVOICE_LOGO_URL || "";
  if (!url) return null;

  // Node 18+ global fetch available on Netlify
  const resp = await fetch(url);
  if (!resp.ok) {
    console.warn("[invoiceCore] logo fetch failed:", resp.status, url);
    return null;
  }
  return Buffer.from(await resp.arrayBuffer());
}

/* ---------------- PDF ---------------- */

async function renderPdf({
  invoiceNumber,
  supplier,
  customer,
  industry,
  areaName,
  areaKm2,
  ratePerKm2Cents,
  amountCents,
  subtotalCents,
  vatCents,
  totalCents,
}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4-ish
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const left = 50;
  const right = 545;
  let y = 805;

  const draw = (t, x = left, size = 11, isBold = false) => {
    page.drawText(safeText(t), { x, y, size, font: isBold ? bold : font });
    y -= size + 6;
  };

  const drawRight = (t, size = 11, isBold = false) => {
    const text = safeText(t);
    const w = (isBold ? bold : font).widthOfTextAtSize(text, size);
    page.drawText(text, { x: right - w, y, size, font: isBold ? bold : font });
  };

  const hr = (gap = 10) => {
    y -= gap;
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1 });
    y -= gap;
  };

  // Logo ABOVE title (top-left)
  const logoBytes = await fetchLogoBytes();
  if (logoBytes) {
    try {
      const logoImg = await pdf.embedPng(logoBytes);
      const logoW = 90;
      const logoH = (logoImg.height / logoImg.width) * logoW;
      page.drawImage(logoImg, { x: left, y: y - logoH, width: logoW, height: logoH });
      y -= logoH + 12;
    } catch (e) {
      console.warn("[invoiceCore] logo embed failed:", e?.message || e);
    }
  }

  // Supplier header
  draw(supplier.name, left, 20, true);
  splitAddressLines(supplier.address).forEach((line) => draw(line, left, 11, false));
  draw(supplier.email, left, 11, false);
  if (supplier.vat) draw(`VAT: ${supplier.vat}`, left, 11, false);

  // Invoice meta (right aligned)
  const yMetaTop = 805;
  let yMeta = yMetaTop;
  const meta = [
    ["Invoice", invoiceNumber],
    ["Industry", industry || "General"],
  ];
  meta.forEach(([k, v]) => {
    const key = safeText(`${k}: `);
    const val = safeText(String(v || ""));
    const keyW = bold.widthOfTextAtSize(key, 11);
    page.drawText(key, { x: right - 220, y: yMeta, size: 11, font: bold });
    page.drawText(val, { x: right - 220 + keyW, y: yMeta, size: 11, font });
    yMeta -= 17;
  });

  hr(12);

  // Customer block
  draw("Billed to", left, 12, true);
  draw(customer.business_name || customer.name || "Customer", left, 11, true);
  draw(customer.contact_email || customer.email || "", left, 11, false);
  splitAddressLines(customer.address || "").forEach((line) => draw(line, left, 11, false));

  hr(12);

  // Line item table header
  const colDescX = left;
  const colAreaX = 350;
  const colRateX = 430;
  const colAmtX = right;

  page.drawText("Description", { x: colDescX, y, size: 11, font: bold });
  page.drawText("Area Covered", { x: colAreaX, y, size: 11, font: bold });
  page.drawText("Price / km²", { x: colRateX, y, size: 11, font: bold });
  drawRight("Amount", 11, true);
  y -= 16;

  page.drawLine({
    start: { x: left, y },
    end: { x: right, y },
    thickness: 1,
  });
  y -= 14;

  // Single line item (no "Sponsored Area" wording)
  const desc = `${areaName || "Service Area"} — Featured Coverage`;
  page.drawText(safeText(desc), { x: colDescX, y, size: 11, font });

  const areaStr = `${Number(areaKm2 || 0).toFixed(2)} km²`;
  page.drawText(safeText(areaStr), { x: colAreaX, y, size: 11, font });

  const rateStr = moneyGBP(ratePerKm2Cents);
  page.drawText(safeText(rateStr), { x: colRateX, y, size: 11, font });

  drawRight(moneyGBP(amountCents), 11, false);
  y -= 26;

  // Totals
  const totalsX = right - 200;

  const drawTotalRow = (label, value, boldRow = false) => {
    page.drawText(safeText(label), { x: totalsX, y, size: 11, font: boldRow ? bold : font });
    const txt = safeText(value);
    const w = (boldRow ? bold : font).widthOfTextAtSize(txt, 11);
    page.drawText(txt, { x: right - w, y, size: 11, font: boldRow ? bold : font });
    y -= 16;
  };

  drawTotalRow("Subtotal", moneyGBP(subtotalCents));
  drawTotalRow("VAT", moneyGBP(vatCents));
  y -= 4;
  page.drawLine({ start: { x: totalsX, y }, end: { x: right, y }, thickness: 1 });
  y -= 14;
  drawTotalRow("Total", moneyGBP(totalCents), true);

  // Footer note
  y = Math.max(y, 80);
  page.drawText(
    safeText("Thank you for your business."),
    { x: left, y: 60, size: 10, font }
  );

  return Buffer.from(await pdf.save());
}

/* ---------------- CORE ---------------- */

async function createInvoiceAndEmailByStripeInvoiceId(stripe_invoice_id) {
  console.log("[invoiceCore] start", stripe_invoice_id);

  // Idempotency: if we already have an invoice record, and it's emailed, stop.
  const { data: existing } = await supabase
    .from("invoices")
    .select("id, emailed_at, invoice_number, customer_email")
    .eq("stripe_invoice_id", stripe_invoice_id)
    .maybeSingle();

  if (existing?.emailed_at) return "already-emailed";
  if (existing?.id && !existing?.emailed_at) {
    // We'll allow re-email of an existing record
    console.log("[invoiceCore] found existing invoice, will try emailing:", existing.id);
  }

  const inv = await stripe.invoices.retrieve(stripe_invoice_id);

  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

  if (!subscriptionId) return "no-subscription";

  // Pull subscription context from DB (your schema)
  const { data: subRow } = await supabase
    .from("sponsored_subscriptions")
    .select("business_id, area_id, category_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (!subRow?.business_id) return "no-business-id";
  if (!subRow?.area_id) return "no-area-id";

  // Cleaner details (email is contact_email per your note)
  const { data: cleaner } = await supabase
    .from("cleaners")
    .select("business_name, contact_email, address")
    .eq("id", subRow.business_id)
    .maybeSingle();

  const customerEmail = cleaner?.contact_email || null;
  if (!customerEmail) return "no-email";

  // Area name + compute km2 directly from geometry (so invoice area is always correct)
  const { data: areaRow, error: areaErr } = await supabase
    .from("service_areas")
    .select("name, geom")
    .eq("id", subRow.area_id)
    .maybeSingle();

  if (areaErr) throw areaErr;

  // Compute km² in SQL to avoid geometry parsing in JS
  // (geom isn't needed for JS; we can compute km² with an RPC if you have one.
  // If not, this uses a PostgREST computed select via RPC is cleaner—fallback below)
  let areaKm2 = 0;

  try {
    const { data: km2Row, error: km2Err } = await supabase.rpc("area_km2_for_area", {
      p_area_id: subRow.area_id,
    });
    if (km2Err) throw km2Err;
    areaKm2 = Number(Array.isArray(km2Row) ? km2Row?.[0]?.area_km2 : km2Row?.area_km2);
    if (!Number.isFinite(areaKm2)) areaKm2 = 0;
  } catch (e) {
    // If RPC doesn't exist, do NOT block invoice.
    // We'll fall back to Stripe line item implied area: (amount / rate)
    console.warn("[invoiceCore] area_km2_for_area rpc missing or failed; fallback to Stripe amount", e?.message || e);
    areaKm2 = 0;
  }

  // Industry (category name)
  let industryName = "General";
  if (subRow.category_id) {
    const { data: category } = await supabase
      .from("service_categories")
      .select("name")
      .eq("id", subRow.category_id)
      .maybeSingle();
    if (category?.name) industryName = category.name;
  }

  // Rate per km² / month comes from env (you already use £1.00 in UI)
  const ratePerKm2 = Number(
    process.env.RATE_GOLD_PER_KM2_PER_MONTH ??
      process.env.RATE_PER_KM2_PER_MONTH ??
      1
  );
  const ratePerKm2Cents = Math.round(ratePerKm2 * 100);

  // Stripe line items (use the subscription item amount)
  const linesResp = await stripe.invoices.listLineItems(inv.id, { limit: 100 });
  const first = linesResp.data?.[0];
  const amountCents = Number(first?.amount ?? inv.total ?? 0);

  // If areaKm2 missing (no RPC), infer from amount/rate so invoice shows something sensible
  if (!areaKm2 && ratePerKm2 > 0) {
    areaKm2 = amountCents / 100 / ratePerKm2;
  }

  // VAT (optional)
  const vatRate = Number(process.env.INVOICE_VAT_RATE || 0); // e.g. 0.2 for 20%
  const subtotalCents = amountCents;
  const vatCents = Math.round(subtotalCents * vatRate);
  const totalCents = subtotalCents + vatCents;

  const now = new Date();
  const invoiceNumber =
    existing?.invoice_number ||
    `INV-${now.getUTCFullYear()}-${String(Date.now()).slice(-6)}`;

  // Generate PDF
  const pdf = await renderPdf({
    invoiceNumber,
    supplier: supplierDetails(),
    customer: {
      business_name: cleaner?.business_name || "Customer",
      contact_email: customerEmail,
      address: cleaner?.address || "",
    },
    industry: industryName,
    areaName: areaRow?.name || "Service Area",
    areaKm2,
    ratePerKm2Cents,
    amountCents,
    subtotalCents,
    vatCents,
    totalCents,
  });

  // Upsert invoice DB record (store the same "from" email on the invoice)
  const payload = {
    cleaner_id: subRow.business_id,
    area_id: subRow.area_id,
    stripe_invoice_id: inv.id,
    stripe_payment_intent_id: inv.payment_intent || null,
    invoice_number: invoiceNumber,
    status: inv.status || "paid",
    subtotal_cents: subtotalCents,
    tax_cents: vatCents,
    total_cents: totalCents,
    currency: String(inv.currency || "gbp").toUpperCase(),
    billing_period_start: inv.period_start ? iso(inv.period_start) : iso(inv.created),
    billing_period_end: inv.period_end ? iso(inv.period_end) : iso(inv.created),

    supplier_name: supplierDetails().name,
    supplier_address: supplierDetails().address,
    supplier_email: supplierDetails().email,
    supplier_vat: supplierDetails().vat,

    customer_name: cleaner?.business_name || "Customer",
    customer_email: customerEmail,
    customer_address: cleaner?.address || "",

    area_km2: Number(areaKm2.toFixed(2)),
    rate_per_km2_cents: ratePerKm2Cents,
  };

  const { data: invoiceRow, error: upErr } = await supabase
    .from("invoices")
    .upsert(payload, { onConflict: "stripe_invoice_id" })
    .select("id")
    .single();

  if (upErr) throw upErr;

  // Send email (must be from your verified domain!)
  const fromEmail = process.env.INVOICE_FROM_EMAIL || "Kleanly <kleanly@nibing.uy>";

  const sendResp = await resend.emails.send({
    from: fromEmail,
    to: customerEmail,
    subject: `Invoice ${invoiceNumber} (${industryName})`,
    attachments: [
      { filename: `${invoiceNumber}.pdf`, content: pdf.toString("base64") },
    ],
    html: `<p>Your invoice <strong>${invoiceNumber}</strong> is attached.</p>
           <p><strong>Industry:</strong> ${safeText(industryName)}<br/>
           <strong>Area:</strong> ${safeText(areaRow?.name || "")}</p>`,
  });

  console.log("[invoiceCore] resend response:", sendResp);

  // Mark emailed_at only if Resend accepted (no error)
  if (!sendResp?.error) {
    await supabase
      .from("invoices")
      .update({ emailed_at: new Date().toISOString() })
      .eq("stripe_invoice_id", inv.id);
  }

  return sendResp?.error ? "email-error" : (existing?.id ? "emailed-existing" : "OK");
}

module.exports = { createInvoiceAndEmailByStripeInvoiceId };
