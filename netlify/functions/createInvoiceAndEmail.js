// netlify/functions/_lib/createInvoiceCore.js
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
  // Make sure nibing.uy domain + sender are verified in Resend
  const fromEmail = process.env.INVOICE_FROM_EMAIL || "Kleanly <kleanly@nibing.uy>";

  // Best effort: derive supplier "email" shown on the invoice from the FROM address
  // e.g. "Kleanly <kleanly@nibing.uy>" -> "kleanly@nibing.uy"
  const m = String(fromEmail).match(/<([^>]+)>/);
  const displayEmail = m?.[1] || process.env.INVOICE_SUPPLIER_EMAIL || "kleanly@nibing.uy";

  return {
    fromEmail,
    name: process.env.INVOICE_SUPPLIER_NAME || "Kleanly",
    address: process.env.INVOICE_SUPPLIER_ADDRESS || "UK",
    email: displayEmail,
    vat: process.env.INVOICE_SUPPLIER_VAT || "",
    logoUrl: process.env.INVOICE_LOGO_URL || "", // https://.../logo.png (PNG recommended)
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
    .replace(/[^\x09\x0A\x0D\x20-\x7E£]/g, ""); // keep basic ASCII + £
}

async function fetchLogoBytes(url) {
  if (!url) return null;
  if (!fetchFn) return null;
  try {
    const resp = await fetchFn(url);
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

async function getIndustryName(categoryId) {
  if (!categoryId) return "Industry";

  // Try categories first
  try {
    const { data: cat } = await supabase
      .from("categories")
      .select("name")
      .eq("id", categoryId)
      .maybeSingle();
    if (cat?.name) return cat.name;
  } catch (_) {}

  // Fallback: service_categories
  try {
    const { data: cat2 } = await supabase
      .from("service_categories")
      .select("name")
      .eq("id", categoryId)
      .maybeSingle();
    if (cat2?.name) return cat2.name;
  } catch (_) {}

  return "Industry";
}

function clampStr(s, max = 120) {
  const x = safeText(s);
  if (x.length <= max) return x;
  return x.slice(0, max - 1) + "…";
}

function wrapByWidth(text, font, fontSize, maxWidth) {
  const s = safeText(text);
  if (!s) return [""];
  const words = s.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  const widthOf = (t) => font.widthOfTextAtSize(t, fontSize);

  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (widthOf(next) <= maxWidth) {
      line = next;
    } else {
      if (line) lines.push(line);
      // single word longer than maxWidth => hard break
      if (widthOf(w) > maxWidth) {
        let chunk = "";
        for (const ch of w) {
          const nxt = chunk + ch;
          if (widthOf(nxt) <= maxWidth) chunk = nxt;
          else {
            if (chunk) lines.push(chunk);
            chunk = ch;
          }
        }
        line = chunk;
      } else {
        line = w;
      }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [s];
}

async function uploadInvoicePdfToStorage({ invoiceNumber, businessId, stripeInvoiceId, pdfBuffer }) {
  const bucket = process.env.INVOICE_PDF_BUCKET || "invoices";
  const prefix = process.env.INVOICE_PDF_PREFIX || "pdf";
  const fileName = `${invoiceNumber}.pdf`;

  // Keep it stable + unique-ish
  const path = `${prefix}/${businessId}/${stripeInvoiceId || invoiceNumber}/${fileName}`;

  try {
    // NOTE: This assumes the bucket exists (create it in Supabase Storage).
    // We intentionally do not throw on errors here; invoices can still be emailed without storage.
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (upErr) {
      console.warn("[invoiceCore] storage upload failed:", upErr);
      return { ok: false, bucket, path, error: upErr };
    }

    return { ok: true, bucket, path };
  } catch (e) {
    console.warn("[invoiceCore] storage upload exception:", e);
    return { ok: false, bucket, path, error: e };
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
  industryName,
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
  const pageH = 842;
  const top = pageH - margin;

  // optional logo (centered above title)
  let logoImg = null;
  let logoDims = null;

  const logoBytes = await fetchLogoBytes(supplier.logoUrl);
  if (logoBytes) {
    try {
      logoImg = await pdf.embedPng(logoBytes);
      const targetH = 64; // logo height
      const scale = targetH / logoImg.height;
      logoDims = { w: logoImg.width * scale, h: logoImg.height * scale };
    } catch {
      logoImg = null;
      logoDims = null;
    }
  }

  // --- Header: logo above title (centered) ---
  let y = top;

  if (logoImg && logoDims) {
    const xLogo = (pageW - logoDims.w) / 2;
    page.drawImage(logoImg, {
      x: xLogo,
      y: y - logoDims.h,
      width: logoDims.w,
      height: logoDims.h,
    });
    y -= logoDims.h + 10;
  }

  // Supplier title centered
  const title = safeText(supplier.name);
  const titleSize = 22;
  const titleW = bold.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: (pageW - titleW) / 2,
    y: y - titleSize,
    size: titleSize,
    font: bold,
  });
  y -= titleSize + 14;

  // Supplier address block (left)
  const leftX = margin;
  const addrLines = splitAddressLines(supplier.address);
  addrLines.forEach((ln) => {
    page.drawText(safeText(ln), { x: leftX, y, size: 10.5, font });
    y -= 14;
  });

  page.drawText(safeText(supplier.email), { x: leftX, y, size: 10.5, font });
  y -= 14;

  if (supplier.vat) {
    page.drawText(`VAT: ${safeText(supplier.vat)}`, { x: leftX, y, size: 10.5, font });
    y -= 14;
  }

  // Invoice meta (right side)
  const rightX = pageW - margin;

  const metaRows = [
    ["Invoice #", invoiceNumber],
    ["Invoice date", invoiceDate],
    ["Billing period", `${billingPeriodStart} to ${billingPeriodEnd}`],
    ["Industry", industryName],
  ];

  // Pin metaY to a safe position near top-right
  let metaY = pageH - margin - 40;

  metaRows.forEach(([k, v]) => {
    const key = safeText(k);
    const val = safeText(v);

    const keyW = bold.widthOfTextAtSize(key, 10.5);
    const valW = font.widthOfTextAtSize(val, 10.5);

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

  page.drawText(safeText(customer.name || "Customer"), {
    x: margin,
    y: curY,
    size: 11,
    font: bold,
  });
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
  curY -= 18;

  const col = {
    desc: margin,
    area: 315,
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
  // IMPORTANT: wrap the description so "Industry - Area" cannot look like it's missing.
  const descFontSize = 10.5;
  const descMaxW = col.area - col.desc - 12; // leave a little gap before next column
  const descFull = `${industryName || "Industry"} - ${areaName || "Area"}`;
  const descLines = wrapByWidth(descFull, font, descFontSize, descMaxW).slice(0, 2); // cap at 2 lines for tidy layout

  const areaTxt = `${Number(areaCoveredKm2 || 0).toFixed(3)} km²`;
  const rateTxt = moneyGBP(ratePerKm2Cents);
  const amtTxt = moneyGBP(lineAmountCents);

  // draw description (multi-line)
  descLines.forEach((ln, i) => {
    page.drawText(safeText(ln), { x: col.desc, y: curY - i * 12, size: descFontSize, font });
  });

  // align the other columns to the first line baseline
  page.drawText(areaTxt, { x: col.area, y: curY, size: 10.5, font });
  page.drawText(rateTxt, { x: col.rate, y: curY, size: 10.5, font });
  page.drawText(amtTxt, { x: col.amt, y: curY, size: 10.5, font });

  // Move cursor down depending on whether we used 1 or 2 lines
  curY -= descLines.length > 1 ? 44 : 32;

  // Totals block
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

  // Footer
  page.drawText("Thank you for your business.", { x: margin, y: 60, size: 10, font });

  return Buffer.from(await pdf.save());
}

/* ---------------- CORE ---------------- */

async function createInvoiceAndEmailByStripeInvoiceId(stripe_invoice_id, opts = {}) {
  const force = !!opts.force;
  console.log("[invoiceCore] start", stripe_invoice_id, { force });

  // Pull Stripe invoice
  const inv = await stripe.invoices.retrieve(stripe_invoice_id);

  // Existing invoice row?
  const { data: existing } = await supabase
    .from("invoices")
    .select("id, invoice_number, emailed_at")
    .eq("stripe_invoice_id", stripe_invoice_id)
    .maybeSingle();

  if (existing?.emailed_at && !force) {
    return "already-emailed";
  }

  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

  if (!subscriptionId) return "no-subscription";

  // Find sponsored subscription row
  const { data: subRow } = await supabase
    .from("sponsored_subscriptions")
    .select("business_id, area_id, category_id, slot")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (!subRow?.business_id) return "no-business-id";

  // Cleaner info (email is contact_email)
  const { data: cleaner } = await supabase
    .from("cleaners")
    .select("business_name, contact_email, address")
    .eq("id", subRow.business_id)
    .maybeSingle();

  const customerEmail = cleaner?.contact_email || "";
  if (!customerEmail) return "no-email";

  // Area name
  let areaName = "Area";
  if (subRow.area_id) {
    const { data: area } = await supabase
      .from("service_areas")
      .select("name")
      .eq("id", subRow.area_id)
      .maybeSingle();
    if (area?.name) areaName = area.name;
  }

  // Category/Industry:
  // Sometimes category_id might be missing on sponsored_subscriptions (older rows / edge cases),
  // so also try Stripe invoice metadata as a fallback.
  const meta = inv.metadata || {};
  const metaCategoryId =
    meta.category_id || meta.categoryId || meta.service_category_id || meta.serviceCategoryId || null;

  const categoryId = subRow.category_id || metaCategoryId || null;

  // Industry name
  const industryName = await getIndustryName(categoryId);

  // Stripe amounts (source of truth)
  const linesResp = await stripe.invoices.listLineItems(inv.id, { limit: 100 });
  const firstLine = linesResp.data?.[0];

  const lineAmountCents = Number(firstLine?.amount ?? inv.subtotal ?? inv.total ?? 0);

  // Rate used at checkout (defaults to £1.00 / km² if env not set)
  // You can set RATE_PER_KM2_PER_MONTH_CENTS=100 in Netlify env
  const ratePerKm2Cents = Number(process.env.RATE_PER_KM2_PER_MONTH_CENTS || 100);

  // Compute “area covered” from billing so it ALWAYS matches what was charged.
  // This is correct when a user buys remaining area (partial) for an already-owned polygon.
  const areaCoveredKm2 = ratePerKm2Cents > 0 ? lineAmountCents / ratePerKm2Cents : 0;

  const vatCents = Number(inv.tax ?? 0);
  const totalCents = Number(inv.total ?? (lineAmountCents + vatCents));

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
    industryName,
    areaName,
    areaCoveredKm2,
    ratePerKm2Cents,
    lineAmountCents,
    vatCents,
    totalCents,
  });

  // ✅ Ensure invoice record is stored (and kept up to date)
  // - If it doesn't exist: insert
  // - If it exists: update (keeps totals/status aligned with Stripe)
  const invoiceRow = {
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

    // nice-to-have fields (only work if columns exist; see "safe update" below)
    // category_id: categoryId,
    // industry_name: industryName,
    // area_name: areaName,
  };

  if (!existing?.id) {
    const { error } = await supabase.from("invoices").insert(invoiceRow);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("invoices")
      .update(invoiceRow)
      .eq("stripe_invoice_id", inv.id);
    if (error) throw error;
  }

  // ✅ Optional: store the PDF so you can list/download invoices in-app
  // This uploads to Supabase Storage bucket (default: "invoices") and then *tries*
  // to write the path to the invoices row. If the column doesn't exist, it will not fail the invoice.
  const storePdf = String(process.env.STORE_INVOICE_PDF || "true").toLowerCase() !== "false";
  let storageInfo = null;

  if (storePdf) {
    storageInfo = await uploadInvoicePdfToStorage({
      invoiceNumber,
      businessId: subRow.business_id,
      stripeInvoiceId: inv.id,
      pdfBuffer: pdf,
    });

    if (storageInfo?.ok) {
      // Try to store in DB if you have a column like pdf_path/pdf_storage_path/pdf_bucket
      // We intentionally ignore errors here so missing columns don't break invoicing.
      const tryUpdates = [
        { pdf_path: `${storageInfo.bucket}/${storageInfo.path}` },
        { pdf_storage_path: storageInfo.path, pdf_storage_bucket: storageInfo.bucket },
        { pdf_file_path: storageInfo.path, pdf_bucket: storageInfo.bucket },
      ];

      for (const patch of tryUpdates) {
        const { error } = await supabase
          .from("invoices")
          .update(patch)
          .eq("stripe_invoice_id", inv.id);
        if (!error) break; // success with one of the column-name combos
      }
    }
  }

  // Send email
  console.log("[invoiceCore] sending email", { from: supplier.fromEmail, to: customerEmail });

  const emailLine = `${industryName} - ${areaName}`;

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
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5">
        <p>Hi ${safeText(cleaner?.business_name || "there")},</p>
        <p>Please find your invoice <b>${safeText(invoiceNumber)}</b> attached.</p>
        <p><b>${safeText(clampStr(emailLine, 120))}</b></p>
        <p>Total: <b>${moneyGBP(totalCents)}</b></p>
        <p>Thanks,<br/>${safeText(supplier.name)}</p>
      </div>
    `,
  });

  console.log("[invoiceCore] resend response:", sendResp);

  if (sendResp?.error) {
    console.warn("[invoiceCore] resend failed:", sendResp.error);
    return `email-error:${sendResp.error.message || "unknown"}`;
  }

  // Mark emailed
  await supabase
    .from("invoices")
    .update({ emailed_at: new Date().toISOString() })
    .eq("stripe_invoice_id", inv.id);

  return existing?.id ? "emailed-existing" : "OK";
}

module.exports = { createInvoiceAndEmailByStripeInvoiceId };
