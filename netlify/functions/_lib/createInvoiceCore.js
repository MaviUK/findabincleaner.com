// netlify/functions/_lib/createInvoiceCore.js
console.log("LOADED createInvoiceCore v2026-01-06-FIX-SUPABASE-CALLS");

const Stripe = require("stripe");
const { getSupabaseAdmin } = require("./supabase");
const { Resend } = require("resend");
const { PDFDocument, StandardFonts } = require("pdf-lib");

// Node 18+ has global fetch
const fetchFn = global.fetch;

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("[invoiceCore] Missing STRIPE_SECRET_KEY env var");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// ✅ IMPORTANT: supabase is a FUNCTION returning the client
const supabase = () => getSupabaseAdmin();

// ✅ Create Resend lazily so missing key doesn't crash import-time
const resendClient = () => {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY env var");
  }
  return new Resend(process.env.RESEND_API_KEY);
};

/* ---------------- helpers ---------------- */

function supplierDetails() {
  const fromEmail = process.env.INVOICE_FROM_EMAIL || "Kleanly <kleanly@nibing.uy>";
  const m = String(fromEmail).match(/<([^>]+)>/);
  const displayEmail = m?.[1] || process.env.INVOICE_SUPPLIER_EMAIL || "kleanly@nibing.uy";

  return {
    fromEmail,
    name: process.env.INVOICE_SUPPLIER_NAME || "Kleanly",
    address: process.env.INVOICE_SUPPLIER_ADDRESS || "UK",
    email: displayEmail,
    vat: process.env.INVOICE_SUPPLIER_VAT || "",
    logoUrl: process.env.INVOICE_LOGO_URL || "",
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
    .replace(/\u2192/g, "->")
    .replace(/[^\x09\x0A\x0D\x20-\x7E£]/g, "");
}

function clampStr(s, max = 120) {
  const x = safeText(s);
  if (x.length <= max) return x;
  return x.slice(0, max - 1) + "…";
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

  // categories
  try {
    const { data: cat } = await supabase()
      .from("categories")
      .select("name")
      .eq("id", categoryId)
      .maybeSingle();
    if (cat?.name) return cat.name;
  } catch (_) {}

  // service_categories
  try {
    const { data: cat2 } = await supabase()
      .from("service_categories")
      .select("name")
      .eq("id", categoryId)
      .maybeSingle();
    if (cat2?.name) return cat2.name;
  } catch (_) {}

  return "Industry";
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

/**
 * Store PDF into Supabase Storage and return { ok, bucket, path }
 * Bucket must exist.
 */
async function uploadInvoicePdfToStorage({ invoiceNumber, businessId, stripeInvoiceId, pdfBuffer }) {
  const bucket = process.env.INVOICE_PDF_BUCKET || "invoices";
  const prefix = process.env.INVOICE_PDF_PREFIX || "invoices"; // keep aligned with your current paths
  const fileName = `${invoiceNumber}.pdf`;

  const path = `${prefix}/${businessId}/${fileName}`;

  try {
    const { error: upErr } = await supabase()
      .storage.from(bucket)
      .upload(path, pdfBuffer, { contentType: "application/pdf", upsert: true });

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

async function signInvoicePdfUrl({ bucket, path }) {
  try {
    const expiresIn = Number(process.env.INVOICE_SIGNED_URL_SECONDS || 60 * 60 * 24 * 30); // 30 days
    const { data, error } = await supabase().storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error) return { ok: false, error };
    return { ok: true, signedUrl: data?.signedUrl || null };
  } catch (e) {
    return { ok: false, error: e };
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

  let logoImg = null;
  let logoDims = null;

  const logoBytes = await fetchLogoBytes(supplier.logoUrl);
  if (logoBytes) {
    try {
      logoImg = await pdf.embedPng(logoBytes);
      const targetH = 64;
      const scale = targetH / logoImg.height;
      logoDims = { w: logoImg.width * scale, h: logoImg.height * scale };
    } catch {
      logoImg = null;
      logoDims = null;
    }
  }

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

  const rightX = pageW - margin;

  const metaRows = [
    ["Invoice #", invoiceNumber],
    ["Invoice date", invoiceDate],
    ["Billing period", `${billingPeriodStart} to ${billingPeriodEnd}`],
    ["Industry", industryName],
  ];

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

  const dividerY = Math.min(y, metaY) - 12;
  page.drawLine({
    start: { x: margin, y: dividerY },
    end: { x: pageW - margin, y: dividerY },
    thickness: 1,
  });

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

  curY -= 18;

  const col = { desc: margin, area: 315, rate: 420, amt: 510 };

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

  // ✅ Wrap description so it never looks "missing"
  const descFontSize = 10.5;
  const descMaxW = col.area - col.desc - 12;
  const descFull = `${industryName || "Industry"} - ${areaName || "Area"}`;
  const descLines = wrapByWidth(descFull, font, descFontSize, descMaxW).slice(0, 2);

  const areaTxt = `${Number(areaCoveredKm2 || 0).toFixed(3)} km²`;
  const rateTxt = moneyGBP(ratePerKm2Cents);
  const amtTxt = moneyGBP(lineAmountCents);

  descLines.forEach((ln, i) => {
    page.drawText(safeText(ln), { x: col.desc, y: curY - i * 12, size: descFontSize, font });
  });

  page.drawText(areaTxt, { x: col.area, y: curY, size: 10.5, font });
  page.drawText(rateTxt, { x: col.rate, y: curY, size: 10.5, font });
  page.drawText(amtTxt, { x: col.amt, y: curY, size: 10.5, font });

  curY -= descLines.length > 1 ? 44 : 32;

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

  page.drawText("Thank you for your business.", { x: margin, y: 60, size: 10, font });

  return Buffer.from(await pdf.save());
}

/* ---------------- CORE ---------------- */

async function createInvoiceAndEmailByStripeInvoiceId(stripe_invoice_id, opts = {}) {
  const force = !!opts.force;
  console.log("[invoiceCore] start", stripe_invoice_id, { force });

  const inv = await stripe.invoices.retrieve(stripe_invoice_id);

  // ✅ FIX: supabase() everywhere
  const { data: existing } = await supabase()
    .from("invoices")
    .select("id, invoice_number, emailed_at")
    .eq("stripe_invoice_id", stripe_invoice_id)
    .maybeSingle();

  if (existing?.emailed_at && !force) return "already-emailed";

  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

  if (!subscriptionId) return "no-subscription";

  const { data: subRow } = await supabase()
    .from("sponsored_subscriptions")
    .select("business_id, area_id, category_id, slot, stripe_subscription_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (!subRow?.business_id) return "no-business-id";

  const { data: cleaner } = await supabase()
    .from("cleaners")
    .select("business_name, contact_email, address")
    .eq("id", subRow.business_id)
    .maybeSingle();

  const customerEmail = cleaner?.contact_email || "";
  if (!customerEmail) return "no-email";

  // Area name
  let areaName = "Area";
  if (subRow.area_id) {
    const { data: area } = await supabase()
      .from("service_areas")
      .select("name")
      .eq("id", subRow.area_id)
      .maybeSingle();
    if (area?.name) areaName = area.name;
  }

  // Category/Industry fallback chain
  const invMeta = inv.metadata || {};
  const metaCategoryId =
    invMeta.category_id ||
    invMeta.categoryId ||
    invMeta.service_category_id ||
    invMeta.serviceCategoryId ||
    null;

  let subMetaCategoryId = null;
  try {
    const subLive = await stripe.subscriptions.retrieve(subscriptionId);
    const sm = subLive?.metadata || {};
    subMetaCategoryId =
      sm.category_id || sm.categoryId || sm.service_category_id || sm.serviceCategoryId || null;
  } catch (_) {}

  const categoryId = subRow.category_id || metaCategoryId || subMetaCategoryId || null;
  const industryName = await getIndustryName(categoryId);

  // Stripe amounts (source of truth)
  const linesResp = await stripe.invoices.listLineItems(inv.id, { limit: 100 });
  const firstLine = linesResp.data?.[0];

  const lineAmountCents = Number(firstLine?.amount ?? inv.subtotal ?? inv.total ?? 0);

  const ratePerKm2Cents = Number(process.env.RATE_PER_KM2_PER_MONTH_CENTS || 100);
  const areaCoveredKm2 = ratePerKm2Cents > 0 ? lineAmountCents / ratePerKm2Cents : 0;

  const vatCents = Number(inv.tax ?? 0);
  const totalCents = Number(inv.total ?? lineAmountCents + vatCents);

  const invoiceNumber =
    existing?.invoice_number ||
    `INV-${new Date().getUTCFullYear()}-${String(Date.now()).slice(-6)}`;

  const supplier = supplierDetails();

  const invoiceDate = isoDateFromUnix(inv.created) || new Date().toISOString().slice(0, 10);
  const billingPeriodStart = isoDateFromUnix(inv.period_start) || invoiceDate;
  const billingPeriodEnd = isoDateFromUnix(inv.period_end) || invoiceDate;

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

  // Upsert invoice record
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
  };

  if (!existing?.id) {
    const { error } = await supabase().from("invoices").insert(invoiceRow);
    if (error) throw error;
  } else {
    const { error } = await supabase()
      .from("invoices")
      .update(invoiceRow)
      .eq("stripe_invoice_id", inv.id);
    if (error) throw error;
  }

  // Store PDF + signed URL
  const storePdf = String(process.env.STORE_INVOICE_PDF || "true").toLowerCase() !== "false";
  if (storePdf) {
    const storageInfo = await uploadInvoicePdfToStorage({
      invoiceNumber,
      businessId: subRow.business_id,
      stripeInvoiceId: inv.id,
      pdfBuffer: pdf,
    });

    if (storageInfo?.ok) {
      const signed = await signInvoicePdfUrl({ bucket: storageInfo.bucket, path: storageInfo.path });

      await supabase()
        .from("invoices")
        .update({
          pdf_storage_path: storageInfo.path,
          pdf_signed_url: signed?.ok ? signed.signedUrl : null,
        })
        .eq("stripe_invoice_id", inv.id);
    }
  }

  // Send email
  console.log("[invoiceCore] sending email", { from: supplier.fromEmail, to: customerEmail });

  const emailLine = `${industryName} - ${areaName}`;

  const sendResp = await resendClient().emails.send({
    from: supplier.fromEmail,
    to: customerEmail,
    subject: `Invoice ${invoiceNumber}`,
    attachments: [{ filename: `${invoiceNumber}.pdf`, content: pdf.toString("base64") }],
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

  await supabase()
    .from("invoices")
    .update({ emailed_at: new Date().toISOString() })
    .eq("stripe_invoice_id", inv.id);

  return existing?.id ? "emailed-existing" : "OK";
}

module.exports = { createInvoiceAndEmailByStripeInvoiceId };
