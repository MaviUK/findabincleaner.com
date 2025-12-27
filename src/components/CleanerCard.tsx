// src/components/CleanerCard.tsx
import { useMemo, useState } from "react";
import { Autocomplete } from "@react-google-maps/api";
import { getOrCreateSessionId, recordEventFetch } from "../lib/analytics";

type Cleaner = {
  cleaner_id: string;
  business_name: string | null;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
  whatsapp?: string | null;
  distance_m?: number | null;

  area_id?: string | null;
  area_name?: string | null;
  category_id?: string | null;

  is_covering_sponsor?: boolean;

  // ✅ NEW (passed through from ResultsList)
  google_rating?: number | null;
  google_reviews_count?: number | null;
};

type Props = {
  cleaner: Cleaner;
  postcodeHint?: string;
  showPayments?: boolean;
  areaId?: string | null;
  categoryId?: string | null;
  position?: number;
  featured?: boolean;
};

function normalizeUrl(u: string) {
  const trimmed = u.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function digitsOnly(s: string) {
  return (s || "").replace(/[^\d+]/g, "");
}

function buildWhatsAppUrl(whatsapp: string, text: string) {
  const raw = (whatsapp || "").trim();
  if (!raw) return "";

  // If they stored a full wa.me link already
  if (raw.startsWith("http")) {
    const join = raw.includes("?") ? "&" : "?";
    return `${raw}${join}text=${encodeURIComponent(text)}`;
  }

  const d = digitsOnly(raw);
  const noPlus = d.startsWith("+") ? d.slice(1) : d;
  return `https://wa.me/${noPlus}?text=${encodeURIComponent(text)}`;
}

function isValidEmail(v: string) {
  const s = (v || "").trim();
  if (!s) return false;
  // simple, safe check
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default function CleanerCard({
  cleaner,
  areaId,
  categoryId,
  position,
  featured,
}: Props) {
  const sessionId = useMemo(() => getOrCreateSessionId(), []);

  const name = cleaner.business_name || "Cleaner";
  const websiteUrl = cleaner.website ? normalizeUrl(cleaner.website) : "";
  const phone = cleaner.phone?.trim() || "";
  const whatsapp = cleaner.whatsapp?.trim() || "";

  // ✅ modal state
  const [showEnquiry, setShowEnquiry] = useState(false);

  // ✅ enquiry form state
  const [enqName, setEnqName] = useState("");
  const [enqAddress, setEnqAddress] = useState("");
  const [enqPhone, setEnqPhone] = useState("");
  const [enqEmail, setEnqEmail] = useState("");
  const [enqMessage, setEnqMessage] = useState("");
  const [enqError, setEnqError] = useState<string | null>(null);
  const [enqSending, setEnqSending] = useState(false);

  // Google Places loaded?
  const hasPlaces =
    typeof window !== "undefined" &&
    (window as any).google &&
    (window as any).google.maps &&
    (window as any).google.maps.places;

  // Keep a ref to the google autocomplete instance
  const [ac, setAc] = useState<any>(null);

  function logClick(event: "click_message" | "click_phone" | "click_website") {
    try {
      void recordEventFetch({
        event,
        cleanerId: cleaner.cleaner_id,
        areaId: areaId ?? null,
        categoryId: categoryId ?? null,
        sessionId,
        meta: { position: position ?? null },
      });
    } catch (e) {
      console.warn("record click failed", e);
    }
  }

  // ✅ KEEP: important — unchanged
  function openWhatsAppOrCall() {
    if (whatsapp) {
      const wa = whatsapp.replace(/[^\d+]/g, "");
      window.open(`https://wa.me/${wa}`, "_blank", "noopener,noreferrer");
      return;
    }
    if (phone) window.location.href = `tel:${phone}`;
  }

  const canSend =
    enqName.trim().length > 0 &&
    enqAddress.trim().length > 0 &&
    enqPhone.trim().length > 0 &&
    isValidEmail(enqEmail) &&
    enqMessage.trim().length > 0 &&
    !enqSending;

  async function sendEnquiryEmail() {
    setEnqError(null);

    // Hard validation (also ensures "can't send until filled in")
    if (!enqName.trim()) return setEnqError("Please enter your name.");
    if (!enqAddress.trim()) return setEnqError("Please select your address.");
    if (!enqPhone.trim()) return setEnqError("Please enter your phone number.");
    if (!isValidEmail(enqEmail)) return setEnqError("Please enter a valid email address.");
    if (!enqMessage.trim()) return setEnqError("Please enter your message.");

    setEnqSending(true);
    try {
      const payload = {
        cleanerId: cleaner.cleaner_id,
        cleanerName: cleaner.business_name ?? "",
        name: enqName,
        address: enqAddress,
        phone: enqPhone,
        email: enqEmail,
        message: enqMessage,
      };

      const res = await fetch("/.netlify/functions/sendEnquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || "Failed to send enquiry.");
      }

      setShowEnquiry(false);

      // clear after send
      setEnqName("");
      setEnqAddress("");
      setEnqPhone("");
      setEnqEmail("");
      setEnqMessage("");
      setEnqError(null);
    } catch (e: any) {
      setEnqError(e?.message || "Sorry — something went wrong sending your enquiry.");
    } finally {
      setEnqSending(false);
    }
  }

  // Featured logo: bigger than button stack, no border
  const logoBoxClass = featured
    ? "h-40 w-40 rounded-2xl bg-white overflow-hidden shrink-0 flex items-center justify-center"
    : "h-16 w-16 rounded-xl bg-gray-100 overflow-hidden shrink-0 flex items-center justify-center";

  // Keep logo crisp, no cropping
  const logoImgClass = featured
    ? "h-full w-full object-contain"
    : "h-full w-full object-cover";

  const whatsappPrefill = useMemo(() => {
    const text =
      `Enquiry for ${name}\n\n` +
      `Name: ${enqName || "-"}\n` +
      `Address: ${enqAddress || "-"}\n` +
      `Phone: ${enqPhone || "-"}\n` +
      `Email: ${enqEmail || "-"}\n\n` +
      `${enqMessage || ""}`;
    return text;
  }, [name, enqName, enqAddress, enqPhone, enqEmail, enqMessage]);

  return (
    <>
      <div className="rounded-2xl border border-black/5 bg-white shadow-sm p-4 sm:p-5 flex gap-4">
        {/* Logo */}
        <div className={logoBoxClass}>
          {cleaner.logo_url ? (
            <img
              src={cleaner.logo_url}
              alt={cleaner.business_name ?? "Business logo"}
              className={logoImgClass}
            />
          ) : null}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            {/* Info */}
            <div className={`min-w-0 ${featured ? "pt-1" : ""}`}>
              <div className="text-lg font-bold text-gray-900 truncate">{name}</div>

              {/* ✅ GOOGLE RATING (from RPC) */}
              {typeof (cleaner as any).google_rating === "number" && (
                <div className="text-xs text-gray-600 mt-1">
                  ⭐ {(cleaner as any).google_rating.toFixed(1)}{" "}
                  {typeof (cleaner as any).google_reviews_count === "number"
                    ? `(${(cleaner as any).google_reviews_count} reviews)`
                    : ""}
                </div>
              )}

              {typeof cleaner.distance_m === "number" && (
                <div className="text-xs text-gray-500 mt-1">
                  {(cleaner.distance_m / 1000).toFixed(1)} km
                </div>
              )}

              {/* MOBILE ICON ACTIONS */}
              <div className="flex gap-3 mt-3 sm:hidden">
                {/* Message */}
                <button
                  type="button"
                  className="h-10 w-10 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 disabled:opacity-40"
                  onClick={() => {
                    logClick("click_message");
                    setShowEnquiry(true);
                  }}
                  disabled={!whatsapp && !phone}
                  title="Message"
                >
                  💬
                </button>

                {/* Phone */}
                <button
                  type="button"
                  className="h-10 w-10 rounded-full border border-blue-200 text-blue-700 flex items-center justify-center hover:bg-blue-50 disabled:opacity-40"
                  onClick={() => {
                    logClick("click_phone");
                    if (phone) window.location.href = `tel:${phone}`;
                  }}
                  disabled={!phone}
                  title="Call"
                >
                  📞
                </button>

                {/* Website */}
                <button
                  type="button"
                  className="h-10 w-10 rounded-full border border-gray-200 text-gray-800 flex items-center justify-center hover:bg-gray-50 disabled:opacity-40"
                  onClick={() => {
                    logClick("click_website");
                    if (websiteUrl) window.open(websiteUrl, "_blank", "noopener,noreferrer");
                  }}
                  disabled={!websiteUrl}
                  title="Website"
                >
                  🌐
                </button>
              </div>
            </div>

            {/* DESKTOP ACTIONS */}
            <div className="shrink-0 hidden sm:flex flex-col gap-2 w-44">
              <button
                type="button"
                className="h-10 rounded-full bg-red-500 text-white font-semibold text-sm hover:bg-red-600 disabled:opacity-50"
                onClick={() => {
                  logClick("click_message");
                  setShowEnquiry(true);
                }}
                disabled={!whatsapp && !phone}
              >
                Message
              </button>

              <button
                type="button"
                className="h-10 rounded-full border border-blue-200 text-blue-700 font-semibold text-sm hover:bg-blue-50 disabled:opacity-50"
                onClick={() => {
                  logClick("click_phone");
                  if (phone) window.location.href = `tel:${phone}`;
                }}
                disabled={!phone}
              >
                Phone
              </button>

              <button
                type="button"
                className="h-10 rounded-full border border-gray-200 text-gray-800 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50"
                onClick={() => {
                  logClick("click_website");
                  if (websiteUrl) window.open(websiteUrl, "_blank", "noopener,noreferrer");
                }}
                disabled={!websiteUrl}
              >
                Website
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ✅ Enquiry modal */}
      {showEnquiry && (
        <div className="fixed inset-0 z-50">
          {/* backdrop */}
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowEnquiry(false)} />

          {/* modal */}
          <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-6">
            <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl ring-1 ring-black/10 overflow-hidden max-h-[calc(100vh-2rem)]">
              {/* Header */}
              <div className="px-5 pt-5 pb-3 border-b border-black/5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold truncate">Enquiry to {name}</h2>
                    <p className="text-sm text-gray-600 mt-1">
                      Address, phone and email are required.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowEnquiry(false)}
                    className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-black/5"
                    aria-label="Close"
                  >
                    <span className="text-xl leading-none">×</span>
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="px-5 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: "calc(100vh - 210px)" }}>
                <Field label="Your Name *">
                  <input
                    className="h-11 w-full rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/25"
                    value={enqName}
                    onChange={(e) => setEnqName(e.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                    required
                  />
                </Field>

                <Field label="Address *">
                  {hasPlaces ? (
                    <Autocomplete
                      onLoad={(inst) => setAc(inst)}
                      onPlaceChanged={() => {
                        try {
                          const place = ac?.getPlace?.();
                          const value = place?.formatted_address || place?.name || "";
                          if (value) setEnqAddress(value);
                        } catch {
                          // ignore
                        }
                      }}
                    >
                      <input
                        className="h-11 w-full rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/25"
                        value={enqAddress}
                        onChange={(e) => setEnqAddress(e.target.value)}
                        placeholder="Start typing your address…"
                        autoComplete="street-address"
                        required
                      />
                    </Autocomplete>
                  ) : (
                    <input
                      className="h-11 w-full rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/25"
                      value={enqAddress}
                      onChange={(e) => setEnqAddress(e.target.value)}
                      placeholder="House no, street, town, postcode"
                      autoComplete="street-address"
                      required
                    />
                  )}
                  <p className="text-xs text-gray-500">Pick from suggestions for best results.</p>
                </Field>

                <Field label="Phone Number *">
                  <input
                    className="h-11 w-full rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/25"
                    value={enqPhone}
                    onChange={(e) => setEnqPhone(e.target.value)}
                    placeholder="07…"
                    autoComplete="tel"
                    required
                  />
                </Field>

                <Field label="Email Address *">
                  <input
                    className="h-11 w-full rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/25"
                    value={enqEmail}
                    onChange={(e) => setEnqEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />
                  {enqEmail.trim().length > 0 && !isValidEmail(enqEmail) ? (
                    <p className="text-xs text-red-600">Enter a valid email address.</p>
                  ) : null}
                </Field>

                <Field label="Your Message *">
                  <textarea
                    className="min-h-[120px] w-full rounded-xl border border-black/10 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500/25"
                    value={enqMessage}
                    onChange={(e) => setEnqMessage(e.target.value)}
                    placeholder="What do you need? Any notes…"
                    required
                  />
                </Field>

                {enqError && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    {enqError}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-4 border-t border-black/5 bg-white">
                <div className="flex flex-col gap-2">
                  {whatsapp ? (
                    <a
                      className="inline-flex items-center justify-center rounded-xl h-11 px-4 text-sm font-semibold bg-[#25D366] text-white hover:bg-[#20bd59]"
                      href={buildWhatsAppUrl(whatsapp, whatsappPrefill)}
                      target="_blank"
                      rel="noreferrer"
                      onMouseDown={() => logClick("click_message")}
                    >
                      Send via WhatsApp
                    </a>
                  ) : null}

                  <button
                    type="button"
                    onClick={sendEnquiryEmail}
                    disabled={!canSend}
                    className="inline-flex items-center justify-center rounded-xl h-11 px-4 text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={!canSend ? "Fill in name, address, phone, email and message" : "Send enquiry"}
                  >
                    {enqSending ? "Sending…" : "Send Enquiry"}
                  </button>

                  {/* Optional: keep your original quick action reachable */}
                  {!whatsapp && phone ? (
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-xl h-11 px-4 text-sm font-semibold bg-white text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                      onClick={() => {
                        openWhatsAppOrCall();
                      }}
                    >
                      Call Instead
                    </button>
                  ) : null}
                </div>

                <p className="text-xs text-gray-600 pt-2">
                  Your enquiry won’t send until all required fields are completed.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-900">{label}</label>
      {children}
    </div>
  );
}
