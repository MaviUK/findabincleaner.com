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

// pdf-lib standard fonts are WinAnsi. Strip characters that can't be encoded.
function safeText(s) {
  return String(s ?? "").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

function splitAddressLines(addr) {
  const a = safeText(addr || "").trim();
  if (!a) return [];
  return a
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function moneyGBP(cents) {
  return `£${(Number(cents || 0) / 100).toFixed(2)}`;
}

function isoDate(tsSeconds) {
  if (!tsSeconds) return null;
  return new Date(tsSeconds * 1000).toISOString().slice(0, 10);
}

async function fetchBytes(url) {
  // Netlify Node 18+ has global fetch
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Compute area (m²) of a GeoJSON Polygon/MultiPolygon in lon/lat degrees
 * using a spherical Earth approximation.
 * Returns km².
 */
function geojsonKm2(gj) {
  if (!gj) return 0;

  // Accept either raw GeoJSON object or stringified
  let geo = gj;
  if (typeof geo === "string") {
    try {
      geo = JSON.parse(geo);
    } catch {
      return 0;
    }
  }

  const R = 6378137; // meters

  const rad = (d) => (d * Math.PI) / 180;

  // Ring area on sphere (approx)
  // Formula based on spherical excess integration
  const ringArea = (coords) => {
    if (!Array.isArray(coords) || coords.length < 4) return 0;

    let area = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const [lon1, lat1] = coords[i];
      const [lon2, lat2] = coords[i + 1];
      area += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
    }
    area = (area * R * R) / 2;
    return area;
  };

  const polygonArea = (polyCoords) => {
    // polyCoords: [ outerRing, holeRing1, holeRing2... ]
    if (!Array.isArray(polyCoords) || polyCoords.length === 0) return 0;
    const outer = Math.abs(ringArea(polyCoords[0]));
    let holes = 0;
    for (let i = 1; i < polyCoords.length; i++) holes += Math.abs(ringArea(polyCoords[i]));
    return Math.max(0, outer - holes);
  };

  const type = geo.type;

  let m2 = 0;

  if (type === "Polygon") {
    m2 = polygonArea(geo.coordinates);
  } else if (type === "MultiPolygon") {
    for (const poly of geo.coordinates || []) {
      m2 += polygonArea(poly);
    }
  } else if (type === "Feature") {
    return geojsonKm2(geo.geometry);
  } else if (type === "FeatureCollection") {
    for (const f of geo.features || []) {
      m2 += geojsonKm2(f);
    }
  } else {
    return 0;
  }

  const km2 = m2 / 1e6;
  if (!Number.isFinite(km2)) return 0;
  return Math.max(0, km2);
}

/* ---------------- supplier ---------------- */

function supplierDetails() {
  return {
    name: process.env.INVOICE_SUPPLIER_NAME || "Kleanly",
    address: process.env.INVOICE_SUPPLIER_ADDRESS || "UK",
    email: process.env.INVOICE_FROM_EMAIL || process.env.INVOICE_SUPPLIER_EMAIL || "Kleanly@nibing.uy",
    vat: process.env.INVOICE_SUPPLIER_VAT || "",
  };
}

/* ---------------- PDF ---------------- */

async function renderPdf({
  invoiceNumber,
  supplier,
  customer,
  areaName,
  areaKm2,
  ratePerKm2Cents,
  subtotalCents,
  vatCents,
  totalCents,
  issuedDateISO,
  periodStartISO,
  periodEndISO,
  logoUrl,
}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  let y = 820;

  const drawText = (t, x, yy, size = 11, isBold = false) => {
    page.drawText(safeText(t), { x, y: yy, size, font: isBold ? bold : font });
  };

  // ---- Header: logo left, name to the right ----
  let logoW = 0;
  let logoH = 0;

  if (logoUrl) {
    try {
      const bytes = await fetchBytes(logoUrl);
      let img;
      if (String(logoUrl).toLowerCase().endsWith(".png")) img = await pdf.embedPng(bytes);
      else img = await pdf.embedJpg(bytes);

      const maxH = 44;
      const maxW = 44;
      const dims = img.scale(1);
      const s = Math.min(maxW / dims.width, maxH / dims.height);

      logoW = dims.width * s;
      logoH = dims.height * s;

      page.drawImage(img, {
        x: margin,
        y: y - logoH + 6,
        width: logoW,
        height: logoH,
      });
    } catch {
      logoW = 0;
      logoH = 0;
    }
  }

  const headerX = margin + (logoW ? logoW + 10 : 0);
  drawText(supplier.name, headerX, y, 22, true);

  y -= 28;

  // Supplier address: split by commas onto new lines
  const suppLines = splitAddressLines(supplier.address);
  suppLines.forEach((line) => {
    drawText(line, headerX, y, 10, false);
    y -= 14;
  });

  drawText(supplier.email, headerX, y, 10, false);
  y -= 14;

  if (supplier.vat) {
    drawText(`VAT: ${supplier.vat}`, headerX, y, 10, false);
    y -= 14;
  }

  // Right-side invoice meta box
  const metaX = 360;
  const metaTop = 820;
  drawText("INVOICE", metaX, metaTop, 14, true);
  drawText(`Invoice No: ${invoiceNumber}`, metaX, metaTop - 18, 10, false);
  drawText(`Date: ${issuedDateISO || ""}`, metaX, metaTop - 34, 10, false);

  if (periodStartISO || periodEndISO) {
    drawText(
      `Period: ${periodStartISO || ""} to ${periodEndISO || ""}`,
      metaX,
      metaTop - 50,
      10,
      false
    );
  }

  // Divider
  y -= 10;
  page.drawLine({
    start: { x: margin, y },
    end: { x: 595 - margin, y },
    thickness: 1,
  });
  y -= 20;

  // ---- Bill To ----
  drawText("Billed To", margin, y, 12, true);
  y -= 16;

  drawText(customer.name || "", margin, y, 11, true);
  y -= 14;

  const custAddrLines = splitAddressLines(customer.address);
  custAddrLines.forEach((line) => {
    drawText(line, margin, y, 10, false);
    y -= 14;
  });

  drawText(customer.email || "", margin, y, 10, false);
  y -= 22;

  // ---- Table Header ----
  const colDesc = margin;
  const colArea = 290;
  const colRate = 375;
  const colUnit = 455;
  const colAmt = 530;

  drawText("Description", colDesc, y, 10, true);
  drawText("Area Covered", colArea, y, 10, true);
  drawText("Price / KM²", colRate, y, 10, true);
  drawText("Unit price", colUnit, y, 10, true);
  drawText("Amount", colAmt, y, 10, true);

  y -= 10;
  page.drawLine({
    start: { x: margin, y },
    end: { x: 595 - margin, y },
    thickness: 1,
  });
  y -= 16;

  // ---- Line Item ----
  const desc = '${areaName || "Unknown"}`;
  const areaTxt = areaKm2 != null ? `${Number(areaKm2).toFixed(3)} km²` : "";
  const rateTxt = ratePerKm2Cents != null ? moneyGBP(ratePerKm2Cents) : "";
  const unitPriceCents =
    areaKm2 != null && ratePerKm2Cents != null
      ? Math.round(Number(areaKm2) * Number(ratePerKm2Cents))
      : null;
  const unitTxt = unitPriceCents != null ? moneyGBP(unitPriceCents) : "";

  drawText(desc, colDesc, y, 10, true);
  drawText(areaTxt, colArea, y, 10, false);
  drawText(rateTxt, colRate, y, 10, false);
  drawText(unitTxt, colUnit, y, 10, false);
  drawText(moneyGBP(subtotalCents), colAmt, y, 10, false);

  y -= 10;

  // ---- Totals ----
  const totalsXLabel = 380;
  const totalsXValue = 530;

  page.drawLine({
    start: { x: totalsXLabel, y: y + 10 },
    end: { x: 595 - margin, y: y + 10 },
    thickness: 1,
  });

  drawText("Subtotal", totalsXLabel, y, 11, true);
  drawText(moneyGBP(subtotalCents), totalsXValue, y, 11, false);
  y -= 16;

  if (vatCents && Number(vatCents) > 0) {
    drawText("VAT", totalsXLabel, y, 11, true);
    drawText(moneyGBP(vatCents), totalsXValue, y, 11, false);
    y -= 16;
  }

  drawText("Total", totalsXLabel, y, 12, true);
  drawText(moneyGBP(totalCents), totalsXValue, y, 12, true);

  return Buffer.from(await pdf.save());
}

/* ---------------- CORE ---------------- */

async function createInvoiceAndEmailByStripeInvoiceId(stripe_invoice_id) {
  console.log("[invoiceCore] start", stripe_invoice_id);

  // 0) If invoice already exists, send if not emailed
  const { data: existing, error: exErr } = await supabase
    .from("invoices")
    .select("id, emailed_at, customer_email, invoice_number")
    .eq("stripe_invoice_id", stripe_invoice_id)
    .maybeSingle();

  if (exErr) throw exErr;

  if (existing?.id) {
    if (existing.emailed_at) return "already-emailed";
    // attempt to email existing (we’ll regenerate pdf and send)
    const inv = await stripe.invoices.retrieve(stripe_invoice_id);
    const subscriptionId =
      typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

    const { data: subRow } = await supabase
      .from("sponsored_subscriptions")
      .select("business_id, area_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    const { data: cleaner } = await supabase
      .from("cleaners")
      .select("business_name, contact_email, email, address, id")
      .eq("id", subRow?.business_id)
      .maybeSingle();

    const customerEmail = cleaner?.contact_email || cleaner?.email || existing.customer_email;
    if (!customerEmail) return "no-email";

    // service area (name + geojson -> km²)
    let areaName = "Unknown";
    let areaKm2 = 0;
    if (subRow?.area_id) {
      const { data: areaRow } = await supabase
        .from("service_areas")
        .select("name, gj")
        .eq("id", subRow.area_id)
        .maybeSingle();

      if (areaRow?.name) areaName = areaRow.name;
      if (areaRow?.gj) areaKm2 = geojsonKm2(areaRow.gj);
    }

    const supplier = supplierDetails();
    const fromEmail = supplier.email;

    const subtotalCents = Number(inv.subtotal ?? inv.total ?? 0);
    const vatRate = Number(process.env.INVOICE_VAT_RATE || 0); // e.g. 0.2
    const vatCents = vatRate > 0 ? Math.round(subtotalCents * vatRate) : 0;
    const totalCents = subtotalCents + vatCents;

    const ratePerKm2Cents = Number(process.env.RATE_PER_KM2_PER_MONTH_CENTS || 100); // £1.00 default

    const customer = {
      name: cleaner?.business_name || "Customer",
      email: customerEmail,
      address: cleaner?.address || "",
    };

    const logoUrl = process.env.INVOICE_LOGO_URL || null;

    const pdf = await renderPdf({
      invoiceNumber: existing.invoice_number || `INV-${Date.now()}`,
      supplier,
      customer,
      areaName,
      areaKm2,
      ratePerKm2Cents,
      subtotalCents,
      vatCents,
      totalCents,
      issuedDateISO: new Date().toISOString().slice(0, 10),
      periodStartISO: isoDate(inv.period_start),
      periodEndISO: isoDate(inv.period_end),
      logoUrl,
    });

    const sendResp = await resend.emails.send({
      from: fromEmail,
      to: customerEmail,
      subject: `Invoice ${existing.invoice_number || ""}`.trim(),
      attachments: [
        { filename: `${existing.invoice_number || "invoice"}.pdf`, content: pdf.toString("base64") },
      ],
      html: `<p>Your invoice is attached.</p>`,
    });

    console.log("[invoiceCore] resend response:", sendResp);

    // If Resend rejects, do NOT mark emailed
    if (sendResp?.error) {
      return "email-failed";
    }

    await supabase
      .from("invoices")
      .update({ emailed_at: new Date().toISOString() })
      .eq("id", existing.id);

    return "emailed-existing";
  }

  // 1) Retrieve Stripe invoice
  const inv = await stripe.invoices.retrieve(stripe_invoice_id);

  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

  if (!subscriptionId) return "no-subscription";

  // 2) Find sponsored subscription row
  const { data: subRow } = await supabase
    .from("sponsored_subscriptions")
    .select("business_id, area_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (!subRow?.business_id) return "no-business-id";

  // 3) Customer details from cleaners (contact_email)
  const { data: cleaner } = await supabase
    .from("cleaners")
    .select("id, business_name, contact_email, email, address")
    .eq("id", subRow.business_id)
    .maybeSingle();

  const customerEmail = cleaner?.contact_email || cleaner?.email || "";
  if (!customerEmail) return "no-email";

  // 4) service area name + area km² from gj
  let areaName = "Unknown";
  let areaKm2 = 0;

  if (subRow.area_id) {
    const { data: areaRow } = await supabase
      .from("service_areas")
      .select("name, gj")
      .eq("id", subRow.area_id)
      .maybeSingle();

    if (areaRow?.name) areaName = areaRow.name;
    if (areaRow?.gj) areaKm2 = geojsonKm2(areaRow.gj);
  }

  // 5) Amounts (Stripe invoice values)
  const supplier = supplierDetails();
  const fromEmail = supplier.email;

  const subtotalCents = Number(inv.subtotal ?? inv.total ?? 0);
  const vatRate = Number(process.env.INVOICE_VAT_RATE || 0); // e.g. 0.2
  const vatCents = vatRate > 0 ? Math.round(subtotalCents * vatRate) : 0;
  const totalCents = subtotalCents + vatCents;

  const ratePerKm2Cents = Number(process.env.RATE_PER_KM2_PER_MONTH_CENTS || 100);

  const invoiceNumber = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

  const customer = {
    name: cleaner.business_name || "Customer",
    email: customerEmail,
    address: cleaner.address || "",
  };

  const logoUrl = process.env.INVOICE_LOGO_URL || null;

  // 6) Generate PDF
  const pdf = await renderPdf({
    invoiceNumber,
    supplier,
    customer,
    areaName,
    areaKm2,
    ratePerKm2Cents,
    subtotalCents,
    vatCents,
    totalCents,
    issuedDateISO: new Date().toISOString().slice(0, 10),
    periodStartISO: isoDate(inv.period_start),
    periodEndISO: isoDate(inv.period_end),
    logoUrl,
  });

  // 7) Insert invoice row first (so you always track it)
  const { data: invoiceRow, error: insErr } = await supabase
    .from("invoices")
    .insert({
      cleaner_id: subRow.business_id,
      area_id: subRow.area_id,
      stripe_invoice_id: inv.id,
      stripe_payment_intent_id: inv.payment_intent,
      invoice_number: invoiceNumber,
      status: inv.status || "open",
      subtotal_cents: subtotalCents,
      tax_cents: vatCents,
      total_cents: totalCents,
      currency: String(inv.currency || "GBP").toUpperCase(),
      billing_period_start: isoDate(inv.period_start),
      billing_period_end: isoDate(inv.period_end),

      supplier_name: supplier.name,
      supplier_address: supplier.address,
      supplier_email: supplier.email,
      supplier_vat: supplier.vat,

      customer_name: customer.name,
      customer_email: customer.email,
      customer_address: customer.address,

      area_km2: Number(areaKm2 || 0),
      rate_per_km2_cents: ratePerKm2Cents,
    })
    .select()
    .single();

  if (insErr) throw insErr;

  // 8) Send email
  const sendResp = await resend.emails.send({
    from: fromEmail, // ✅ must be verified domain address
    to: customerEmail,
    subject: `Invoice ${invoiceNumber}`,
    attachments: [{ filename: `${invoiceNumber}.pdf`, content: pdf.toString("base64") }],
    html: `<p>Your invoice is attached.</p>`,
  });

  console.log("[invoiceCore] resend response:", sendResp);

  // If Resend rejects, do NOT mark emailed
  if (sendResp?.error) {
    return "email-failed";
  }

  await supabase
    .from("invoices")
    .update({ emailed_at: new Date().toISOString() })
    .eq("id", invoiceRow.id);

  return "OK";
}

module.exports = { createInvoiceAndEmailByStripeInvoiceId };
