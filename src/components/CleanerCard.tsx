// src/components/CleanerCard.tsx
import React, { useMemo, useRef, useState } from "react";
import { Autocomplete } from "@react-google-maps/api";
import { getOrCreateSessionId, recordEventFetch } from "../lib/analytics";

type Cleaner = {
  cleaner_id?: string; // ✅ allow optional
  id?: string;         // ✅ allow preview/other shapes

  business_name: string | null;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
  whatsapp?: string | null;

  area_id?: string | null;
  area_name?: string | null;
  category_id?: string | null;

  is_covering_sponsor?: boolean;

  google_rating?: number | null;
  google_reviews_count?: number | null;

  // ✅ allow legacy naming too
  rating_avg?: number | null;
  rating_count?: number | null;
};

type Props = {
  cleaner: Cleaner;
  postcodeHint?: string;
  showPayments?: boolean;
  areaId?: string | null;
  categoryId?: string | null;
  position?: number;
  featured?: boolean;

  originLat?: number | null;
  originLng?: number | null;
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
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function formatUkPhoneForDisplay(raw: string) {
  if (!raw) return "";
  let s = raw.replace(/\s+/g, "").trim();

  if (s.startsWith("+44")) return "0" + s.slice(3);
  if (s.startsWith("44") && s.length >= 11) return "0" + s.slice(2);

  return s;
}

export default function CleanerCard({
  cleaner,
  areaId,
  categoryId,
  position,
  featured,
}: Props) {
  const sessionId = useMemo(() => getOrCreateSessionId(), []);

  // ✅ FIX: normalize cleanerId (supports preview + different shapes)
  const cleanerId =
    (cleaner.cleaner_id && String(cleaner.cleaner_id)) ||
    (cleaner.id && String(cleaner.id)) ||
    "";

  // ✅ FIX: treat preview cards as non-real
  const isPreview = cleanerId === "preview" || cleanerId === "preview-card" || !cleanerId;

  const name = cleaner.business_name || "Cleaner";
  const websiteUrl = cleaner.website ? normalizeUrl(cleaner.website) : "";
  const phone = cleaner.phone?.trim() || "";
  const whatsapp = cleaner.whatsapp?.trim() || "";

  // ✅ FIX: accept either google_* OR rating_* fields
  const rating =
    typeof cleaner.google_rating === "number"
      ? cleaner.google_rating
      : typeof cleaner.rating_avg === "number"
      ? cleaner.rating_avg
      : null;

  const reviewCount =
    typeof cleaner.google_reviews_count === "number"
      ? cleaner.google_reviews_count
      : typeof cleaner.rating_count === "number"
      ? cleaner.rating_count
      : null;

  const [showEnquiry, setShowEnquiry] = useState(false);
  const [showPhoneNumber, setShowPhoneNumber] = useState(false);

  const [enqName, setEnqName] = useState("");
  const [enqAddress, setEnqAddress] = useState("");
  const [enqPhone, setEnqPhone] = useState("");
  const [enqEmail, setEnqEmail] = useState("");
  const [enqMessage, setEnqMessage] = useState("");

  const [enqError, setEnqError] = useState<string | null>(null);
  const [enqSending, setEnqSending] = useState(false);
  const [enqSent, setEnqSent] = useState(false);

  const [enqAccepted, setEnqAccepted] = useState(false);
  const [lastChannel, setLastChannel] = useState<"email" | "whatsapp" | null>(null);

  const hasPlaces =
    typeof window !== "undefined" &&
    (window as any).google &&
    (window as any).google.maps &&
    (window as any).google.maps.places;

  // ✅ FIX: useRef so onPlaceChanged always reads the latest instance (no stale state)
  const acRef = useRef<any>(null);

  function logClick(event: "click_message" | "click_phone" | "click_website") {
    try {
      // ✅ FIX: never log on preview card
      if (isPreview) return;

      const resolvedAreaId = cleaner.area_id ?? areaId ?? null;
      const resolvedCategoryId = cleaner.category_id ?? categoryId ?? null;

      void recordEventFetch({
        event,
        cleanerId,
        areaId: resolvedAreaId,
        categoryId: resolvedCategoryId,
        sessionId,
        meta: { position: position ?? null },
      });
    } catch (e) {
      console.warn("record click failed", e);
    }
  }

  const canSend =
    enqName.trim().length > 0 &&
    enqAddress.trim().length > 0 &&
    enqPhone.trim().length > 0 &&
    isValidEmail(enqEmail) &&
    enqMessage.trim().length > 0 &&
    enqAccepted &&
    !enqSending;

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

  function validateOrSetError(): boolean {
    if (!enqName.trim()) return setEnqError("Please enter your name."), false;
    if (!enqAddress.trim()) return setEnqError("Please select your address."), false;
    if (!enqPhone.trim()) return setEnqError("Please enter your phone number."), false;
    if (!isValidEmail(enqEmail)) return setEnqError("Please enter a valid email address."), false;
    if (!enqMessage.trim()) return setEnqError("Please enter your message."), false;
    if (!enqAccepted)
      return setEnqError("Please confirm you have read and understood the information."), false;
    setEnqError(null);
    return true;
  }

  async function postEnquiry(channel: "email" | "whatsapp") {
    // ✅ FIX: don’t allow sending from preview card
    if (isPreview) throw new Error("Preview listing cannot send enquiries.");

    const payload = {
      cleanerId,
      cleanerName: cleaner.business_name ?? "",
      name: enqName,
      address: enqAddress,
      phone: enqPhone,
      email: enqEmail,
      message: enqMessage,
      acknowledged: enqAccepted,
      channel,
    };

    const res = await fetch("/.netlify/functions/sendEnquiry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({} as any));
    if (!res.ok || !data?.ok) throw new Error(data?.error || "Failed to send enquiry");
  }

  async function sendEnquiryEmail() {
    setEnqSent(false);
    setEnqError(null);
    if (!validateOrSetError()) return;

    setLastChannel("email");
    setEnqSending(true);

    try {
      await postEnquiry("email");
      setEnqSent(true);
    } catch (e: any) {
      setEnqError(e?.message || "Sorry — something went wrong sending your enquiry.");
      setLastChannel(null);
    } finally {
      setEnqSending(false);
    }
  }

  async function sendViaWhatsApp() {
    setEnqSent(false);
    setEnqError(null);
    if (!validateOrSetError()) return;

    if (!whatsapp) return setEnqError("WhatsApp is not available for this business.");

    setLastChannel("whatsapp");
    setEnqSending(true);

    try {
      await postEnquiry("whatsapp");
      setEnqSent(true);
      window.open(buildWhatsAppUrl(whatsapp, whatsappPrefill), "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setEnqError(e?.message || "Sorry — something went wrong.");
      setLastChannel(null);
    } finally {
      setEnqSending(false);
    }
  }

  function closeEnquiry() {
    setShowEnquiry(false);
    setShowPhoneNumber(false);
    setEnqError(null);
    setEnqSending(false);
    setEnqSent(false);
    setEnqAccepted(false);
    setLastChannel(null);

    setEnqName("");
    setEnqAddress("");
    setEnqPhone("");
    setEnqEmail("");
    setEnqMessage("");
  }

  function openEnquiry() {
    // ✅ FIX: block enquiry modal from preview card (optional — remove if you want it openable)
    if (isPreview) return;
    setShowEnquiry(true);
    setEnqError(null);
    setEnqSent(false);
    setEnqAccepted(false);
    setLastChannel(null);
  }

  const logoBoxClass = featured
    ? "h-40 w-40 rounded-2xl bg-white overflow-hidden shrink-0 flex items-center justify-center"
    : "h-16 w-16 rounded-xl bg-gray-100 overflow-hidden shrink-0 flex items-center justify-center";

  const logoImgClass = featured ? "h-full w-full object-contain" : "h-full w-full object-cover";

  return (
    <>
      <div className="rounded-2xl border border-black/5 bg-white shadow-sm p-4 sm:p-5 flex gap-4">
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
            <div className={`min-w-0 ${featured ? "pt-1" : ""}`}>
              <div className="text-lg font-bold text-gray-900 truncate">{name}</div>

              {/* ✅ rating line */}
              {typeof rating === "number" && (
                <div className="text-xs text-gray-600 mt-1">
                  ⭐ {rating.toFixed(1)}{" "}
                  {typeof reviewCount === "number" ? `(${reviewCount} reviews)` : ""}
                </div>
              )}

              <div className="flex gap-3 mt-3 sm:hidden">
                {(whatsapp || phone) && (
                  <button
                    type="button"
                    className="h-10 w-10 rounded-full bg-teal-600 text-white flex items-center justify-center hover:bg-teal-700"
                    onClick={() => {
                      logClick("click_message");
                      openEnquiry();
                    }}
                    title="Message"
                    disabled={isPreview}
                  >
                    💬
                  </button>
                )}

                {phone && (
                  <button
                    type="button"
                    className="h-10 w-10 rounded-full border border-blue-200 text-blue-700 flex items-center justify-center hover:bg-blue-50"
                    onClick={() => {
                      logClick("click_phone");
                      window.location.href = `tel:${phone}`;
                    }}
                    title="Call"
                    disabled={isPreview}
                  >
                    📞
                  </button>
                )}

                {websiteUrl && (
                  <button
                    type="button"
                    className="h-10 w-10 rounded-full border border-gray-200 text-gray-800 flex items-center justify-center hover:bg-gray-50"
                    onClick={() => {
                      logClick("click_website");
                      window.open(websiteUrl, "_blank", "noopener,noreferrer");
                    }}
                    title="Website"
                  >
                    🌐
                  </button>
                )}
              </div>
            </div>

            <div className="shrink-0 hidden sm:flex flex-col gap-2 w-44">
              {(whatsapp || phone) && (
                <button
                  type="button"
                  className="h-10 rounded-full bg-teal-600 text-white font-semibold text-sm hover:bg-teal-700 disabled:opacity-50"
                  onClick={() => {
                    logClick("click_message");
                    openEnquiry();
                  }}
                  disabled={isPreview}
                >
                  Message
                </button>
              )}

              {phone && (
                <button
                  type="button"
                  className="h-10 rounded-full border border-blue-200 text-blue-700 font-semibold text-sm hover:bg-blue-50 disabled:opacity-50"
                  onClick={() => {
                    logClick("click_phone");
                    setShowPhoneNumber((v) => !v);
                  }}
                  disabled={isPreview}
                >
                  {showPhoneNumber ? formatUkPhoneForDisplay(phone) : "Phone"}
                </button>
              )}

              {websiteUrl && (
                <button
                  type="button"
                  className="h-10 rounded-full border border-gray-200 text-gray-800 font-semibold text-sm hover:bg-gray-50"
                  onClick={() => {
                    logClick("click_website");
                    window.open(websiteUrl, "_blank", "noopener,noreferrer");
                  }}
                >
                  Website
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showEnquiry && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={closeEnquiry} />

          <div className="absolute inset-0 flex items-end sm:items-center justify-center p-3 sm:p-6">
            <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl ring-1 ring-black/10 overflow-hidden flex flex-col max-h-[calc(100dvh-1.5rem)]">
              <div className="px-5 pt-5 pb-3 border-b border-black/5 shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold truncate">Enquiry to {name}</h2>
                    <p className="text-sm text-gray-600 mt-1">
                      Address, phone and email are required.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={closeEnquiry}
                    className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-black/5"
                    aria-label="Close"
                  >
                    <span className="text-xl leading-none">×</span>
                  </button>
                </div>
              </div>

              <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1 overscroll-contain">
                {enqSent && (
                  <div className="text-sm text-green-800 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                    ✅ Enquiry saved.
                    {lastChannel === "email" ? " A copy has been emailed to you." : null}
                    {lastChannel === "whatsapp" ? " WhatsApp opened in a new tab." : null}
                  </div>
                )}

                <Field label="Your Name *">
                  <input
                    className="h-11 w-full rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/25"
                    value={enqName}
                    onChange={(e) => {
                      setEnqName(e.target.value);
                      setEnqSent(false);
                    }}
                    placeholder="Your name"
                    autoComplete="name"
                    required
                  />
                </Field>

                <Field label="Address *">
                  {hasPlaces ? (
                    <Autocomplete
                      onLoad={(inst) => {
                        acRef.current = inst;
                      }}
                      onPlaceChanged={() => {
                        try {
                          const place = acRef.current?.getPlace?.();
                          const value = place?.formatted_address || place?.name || "";
                          if (value) {
                            setEnqAddress(value);
                            setEnqSent(false);
                          }
                        } catch {
                          // ignore
                        }
                      }}
                    >
                      <input
                        className="h-11 w-full rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/25"
                        value={enqAddress}
                        onChange={(e) => {
                          setEnqAddress(e.target.value);
                          setEnqSent(false);
                        }}
                        placeholder="Start typing your address…"
                        autoComplete="street-address"
                        required
                      />
                    </Autocomplete>
                  ) : (
                    <input
                      className="h-11 w-full rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/25"
                      value={enqAddress}
                      onChange={(e) => {
                        setEnqAddress(e.target.value);
                        setEnqSent(false);
                      }}
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
                    onChange={(e) => {
                      setEnqPhone(e.target.value);
                      setEnqSent(false);
                    }}
                    placeholder="07…"
                    autoComplete="tel"
                    required
                  />
                </Field>

                <Field label="Email Address *">
                  <input
                    className="h-11 w-full rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/25"
                    value={enqEmail}
                    onChange={(e) => {
                      setEnqEmail(e.target.value);
                      setEnqSent(false);
                    }}
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
                    onChange={(e) => {
                      setEnqMessage(e.target.value);
                      setEnqSent(false);
                    }}
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

              <div className="px-5 py-4 border-t border-black/5 bg-white shrink-0">
                <div className="flex flex-col gap-2">
                  <label className="flex items-start gap-2 text-[11px] text-gray-600 leading-relaxed py-1">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-gray-300"
                      checked={enqAccepted}
                      onChange={(e) => setEnqAccepted(e.target.checked)}
                    />
                    <span>
                      I have read and understand that my details and message will be shared with the
                      business I am contacting so they can respond. We also store this information
                      securely in Kleanly’s database for up to 24 months for record-keeping, support
                      and service improvement. I may be contacted for feedback about my experience.
                      No marketing.
                    </span>
                  </label>

                  {whatsapp && (
                    <button
                      type="button"
                      disabled={!canSend}
                      className="sm:hidden inline-flex items-center justify-center rounded-xl h-11 px-4 text-sm font-semibold bg-[#25D366] text-white hover:bg-[#20bd59] disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={() => {
                        logClick("click_message");
                        void sendViaWhatsApp();
                      }}
                    >
                      {enqSending && lastChannel === "whatsapp"
                        ? "Saving…"
                        : enqSent && lastChannel === "whatsapp"
                        ? "Opened ✓"
                        : "Send via WhatsApp"}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void sendEnquiryEmail()}
                    disabled={!canSend}
                    className="inline-flex items-center justify-center rounded-xl h-11 px-4 text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {enqSending && lastChannel === "email"
                      ? "Sending…"
                      : enqSent && lastChannel === "email"
                      ? "Sent ✓"
                      : "Send Enquiry"}
                  </button>
                </div>

                <p className="text-xs text-gray-600 pt-2">
                  Your enquiry won’t send until all required fields are completed and you confirm
                  you have read the information above.
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
