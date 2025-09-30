// src/components/CleanerCard.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Autocomplete } from "@react-google-maps/api";
import { PaymentPill } from "./icons/payments";
import { ServicePill } from "./icons/services";
import {
  recordEventBeacon,
  recordEventFromPointBeacon,
  getOrCreateSessionId,
} from "../lib/analytics";

// Broad type to match Settings/ResultsList usage
export type Cleaner = {
  id: string;
  business_name: string;
  logo_url?: string | null;
  distance_m?: number | null;

  website?: string | null;
  phone?: string | null;
  whatsapp?: string | null;

  rating_avg?: number | null;
  rating_count?: number | null;

  payment_methods?: string[] | null; // ["bank_transfer","gocardless","paypal","cash","stripe","card_machine"]
  service_types?: string[] | null;   // ["domestic","commercial"]
};

export type CleanerCardProps = {
  cleaner: Cleaner;
  postcodeHint?: string;
  preview?: boolean;
  showPayments?: boolean;

  onSendEnquiry?: (payload: EnquiryPayload) => Promise<void>;
  emailEndpoint?: string;

  /** For analytics attribution (preferred if available) */
  areaId?: string | null;
  /** Fallback so the DB can compute area when areaId is missing */
  searchLat?: number | null;
  searchLng?: number | null;
};

type EnquiryPayload = {
  cleanerId: string;
  cleanerName: string;
  channels: ("email" | "whatsapp")[];
  name: string;
  address: string;
  phone: string;
  email: string;
  message: string;
};

export default function CleanerCard({
  cleaner,
  showPayments,
  onSendEnquiry,
  emailEndpoint,
  areaId = null,
  searchLat = null,
  searchLng = null,
}: CleanerCardProps) {
  const [showPhone, setShowPhone] = useState(false);
  const [showEnquiry, setShowEnquiry] = useState(false);
  const [submitting, setSubmitting] = useState<null | "email">(null);
  const [error, setError] = useState<string | null>(null);

  // Enquiry form state
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [userPhone, setUserPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  // Session id for analytics
  const sessionId = useMemo(() => getOrCreateSessionId(), []);

  // Device checks
  const [isMobile, setIsMobile] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const setFlags = () => {
      setIsDesktop(mq.matches);
      setIsMobile(detectIsMobile());
    };
    setFlags();
    mq.addEventListener?.("change", setFlags);
    window.addEventListener("resize", setFlags);
    return () => {
      mq.removeEventListener?.("change", setFlags);
      window.removeEventListener("resize", setFlags);
    };
  }, []);

  // Mobile expand/collapse (always open on desktop)
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    if (isDesktop) setMobileOpen(true);
  }, [isDesktop]);

  // Places Autocomplete guard
  const autocompleteRef = useRef<any>(null);
  const hasPlaces =
    typeof window !== "undefined" &&
    (window as any).google &&
    (window as any).google.maps &&
    (window as any).google.maps.places;

  const websiteHref = useMemo(() => {
    if (!cleaner.website) return null;
    return normalizeWebsite(cleaner.website);
  }, [cleaner.website]);

  // Helpers to log + navigate
  function go(href?: string | null, blank?: boolean) {
    if (!href) return;
    if (blank) window.open(href, "_blank", "noopener,noreferrer");
    else window.location.href = href;
  }

  function logClick(event: "click_message" | "click_website" | "click_phone") {
    if (areaId) {
      recordEventBeacon({
        cleanerId: cleaner.id,
        areaId,
        event,
        sessionId,
      });
    } else if (
      typeof searchLat === "number" &&
      isFinite(searchLat) &&
      typeof searchLng === "number" &&
      isFinite(searchLng)
    ) {
      // No areaId on the client → let the DB determine it from the point
      recordEventFromPointBeacon({
        cleanerId: cleaner.id,
        lat: searchLat,
        lng: searchLng,
        event,
        sessionId,
      });
    } else {
      // Last resort: still send without area; DB will store null area_id
      recordEventBeacon({
        cleanerId: cleaner.id,
        areaId: null,
        event,
        sessionId,
      });
    }
  }

  return (
    <div className="bg-white text-night-900 rounded-xl shadow-soft border border-black/5 p-3 sm:p-5">
      {/* MOBILE HEADER (sm:hidden) — logo left, name right, chevron */}
      <div className="sm:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-controls={`card-details-${cleaner.id}`}
          className="w-full flex items-center gap-3"
        >
          <div className="shrink-0 h-16 w-16 rounded-xl overflow-hidden ring-1 ring-black/10 bg-white grid place-items-center">
            {cleaner.logo_url ? (
              <img
                src={cleaner.logo_url}
                alt={`${cleaner.business_name} logo`}
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="text-xl font-semibold">
                {cleaner.business_name?.charAt(0) ?? "C"}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="truncate text-lg font-bold">{cleaner.business_name}</div>
            {isFiniteNumber(cleaner.rating_avg) && (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-xs ring-1 ring-blue-200">
                <span className="font-semibold">
                  {Number(cleaner.rating_avg).toFixed(2)}
                </span>
                {isFiniteNumber(cleaner.rating_count) && (
                  <span className="opacity-70">({cleaner.rating_count})</span>
                )}
              </span>
            )}
          </div>
          <span
            className={`shrink-0 ml-1 inline-block transition-transform duration-200 ${
              mobileOpen ? "rotate-180" : ""
            }`}
            aria-hidden
          >
            ▼
          </span>
        </button>
      </div>

      {/* DESKTOP HEADER (hidden on mobile): original left column with big logo */}
      <div className="hidden sm:flex items-stretch gap-5">
        <div className="flex items-stretch gap-5 flex-1 min-w-0">
          <div className="self-stretch w-[184px] rounded-3xl overflow-hidden">
            {cleaner.logo_url ? (
              <img
                src={cleaner.logo_url}
                alt={`${cleaner.business_name} logo`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full bg-black/5 grid place-items-center">
                <span className="text-2xl font-semibold">
                  {cleaner.business_name?.charAt(0) ?? "C"}
                </span>
              </div>
            )}
          </div>
          <div className="min-w-0 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="truncate text-xl md:text-2xl font-bold">
                  {cleaner.business_name}
                </div>
                {isFiniteNumber(cleaner.rating_avg) && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 px-2.5 py-1 text-sm ring-1 ring-blue-200">
                    <span className="font-semibold">
                      {Number(cleaner.rating_avg).toFixed(2)}
                    </span>
                    {isFiniteNumber(cleaner.rating_count) && (
                      <span className="opacity-70">
                        ({cleaner.rating_count} reviews)
                      </span>
                    )}
                  </span>
                )}
              </div>

              {cleaner.service_types?.length ? (
                <div className="pt-3">
                  <div className="text-sm font-medium text-night-800 mb-1.5">
                    Services
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {cleaner.service_types.map((s, i) => (
                      <ServicePill key={`svc-${i}`} kind={s} />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {(showPayments ?? true) && cleaner.payment_methods?.length ? (
              <div className="pt-3 border-t border-black/5">
                <div className="text-sm font-medium text-night-800 mb-1.5">
                  Payments Accepted
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {cleaner.payment_methods.map((m, i) => (
                    <PaymentPill key={`pay-${i}`} kind={m} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Desktop actions column */}
        <div className="self-stretch flex flex-col items-end justify-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              logClick("click_message");
              setShowEnquiry(true);
            }}
            className="inline-flex items-center justify-center rounded-full h-10 w-40 text-sm font-semibold bg-[#F44336] text-white hover:bg-[#E53935] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#F44336]/60"
          >
            Message
          </button>

          {cleaner.phone && (
            <>
              {!showPhone ? (
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full h-10 w-40 text-sm font-semibold bg-white text-[#0B1B2A] ring-1 ring-[#1D4ED8]/30 hover:ring-[#1D4ED8]/50"
                  onClick={() => setShowPhone(true)}
                  aria-expanded={showPhone}
                >
                  Phone
                </button>
              ) : (
                <a
                  href={`tel:${digitsOnly(cleaner.phone)}`}
                  className="inline-flex items-center justify-center rounded-full h-10 w-40 text-sm font-semibold bg-white text-[#0B1B2A] ring-1 ring-[#1D4ED8]/50"
                  onClick={() => {
                    logClick("click_phone");
                    setShowPhone(false);
                  }}
                  title="Tap to call"
                >
                  {prettyPhone(cleaner.phone)}
                </a>
              )}
            </>
          )}

          {websiteHref && (
            <button
              type="button"
              onClick={() => {
                logClick("click_website");
                go(websiteHref, true);
              }}
              className="inline-flex items-center justify-center rounded-full h-10 w-40 text-sm font-semibold bg-white text-[#0B1B2A] ring-1 ring-black/10 hover:ring-black/20"
            >
              Website
            </button>
          )}
        </div>
      </div>

      {/* DETAILS SECTION (mobile collapsible, desktop always visible) */}
      <div
        id={`card-details-${cleaner.id}`}
        className={`sm:hidden transition-[grid-template-rows,opacity] duration-200 ${
          mobileOpen ? "grid grid-rows-[1fr] opacity-100 mt-3" : "grid grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          {/* Services */}
          {cleaner.service_types?.length ? (
            <div className="pt-2">
              <div className="text-sm font-medium text-night-800 mb-1.5">Services</div>
              <div className="flex flex-wrap gap-1.5">
                {cleaner.service_types.map((s, i) => (
                  <ServicePill key={`msvc-${i}`} kind={s} />
                ))}
              </div>
            </div>
          ) : null}

          {/* Payments */}
          {(showPayments ?? true) && cleaner.payment_methods?.length ? (
            <div className="pt-3 border-t border-black/5">
              <div className="text-sm font-medium text-night-800 mb-1.5">Payments Accepted</div>
              <div className="flex flex-wrap gap-1.5">
                {cleaner.payment_methods.map((m, i) => (
                  <PaymentPill key={`mpay-${i}`} kind={m} />
                ))}
              </div>
            </div>
          ) : null}

          {/* Actions on mobile (full width) */}
          <div className="pt-3 grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => {
                logClick("click_message");
                setShowEnquiry(true);
              }}
              className="inline-flex items-center justify-center rounded-full h-11 w-full text-sm font-semibold bg-[#F44336] text-white hover:bg-[#E53935] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#F44336]/60"
            >
              Message
            </button>

            {cleaner.phone && (
              <>
                {!showPhone ? (
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-full h-11 w-full text-sm font-semibold bg-white text-[#0B1B2A] ring-1 ring-[#1D4ED8]/30 hover:ring-[#1D4ED8]/50"
                    onClick={() => setShowPhone(true)}
                    aria-expanded={showPhone}
                  >
                    Phone
                  </button>
                ) : (
                  <a
                    href={`tel:${digitsOnly(cleaner.phone)}`}
                    className="inline-flex items-center justify-center rounded-full h-11 w-full text-sm font-semibold bg-white text-[#0B1B2A] ring-1 ring-[#1D4ED8]/50"
                    onClick={() => {
                      logClick("click_phone");
                      setShowPhone(false);
                    }}
                    title="Tap to call"
                  >
                    {prettyPhone(cleaner.phone)}
                  </a>
                )}
              </>
            )}

            {websiteHref && (
              <button
                type="button"
                onClick={() => {
                  logClick("click_website");
                  go(websiteHref, true);
                }}
                className="inline-flex items-center justify-center rounded-full h-11 w-full text-sm font-semibold bg-white text-[#0B1B2A] ring-1 ring-black/10 hover:ring-black/20"
              >
                Website
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Enquiry Modal (mobile sheet / desktop dialog) */}
      {showEnquiry && (
        <EnquiryModal
          cleaner={cleaner}
          onClose={() => setShowEnquiry(false)}
          onSendEnquiry={onSendEnquiry}
          emailEndpoint={emailEndpoint}
          isMobile={isMobile}
          // controlled form state + errors so we keep existing UX
          state={{
            name,
            address,
            userPhone,
            email,
            message,
            submitting,
            error,
            setName,
            setAddress,
            setUserPhone,
            setEmail,
            setMessage,
            setSubmitting,
            setError,
          }}
          hasPlaces={hasPlaces}
          autocompleteRef={autocompleteRef}
          // pass analytics info
          areaId={areaId}
          sessionId={sessionId}
        />
      )}
    </div>
  );
}

/* -------- Enquiry Modal extracted to keep file readable -------- */
function EnquiryModal(props: {
  cleaner: Cleaner;
  onClose: () => void;
  onSendEnquiry?: (payload: EnquiryPayload) => Promise<void>;
  emailEndpoint?: string;
  isMobile: boolean;
  state: {
    name: string;
    address: string;
    userPhone: string;
    email: string;
    message: string;
    submitting: null | "email";
    error: string | null;
    setName: (v: string) => void;
    setAddress: (v: string) => void;
    setUserPhone: (v: string) => void;
    setEmail: (v: string) => void;
    setMessage: (v: string) => void;
    setSubmitting: (v: null | "email") => void;
    setError: (v: string | null) => void;
  };
  hasPlaces: boolean;
  autocompleteRef: any;
  /** analytics context */
  areaId: string | null;
  sessionId: string;
}) {
  const {
    cleaner,
    onClose,
    onSendEnquiry,
    emailEndpoint,
    isMobile,
    state: {
      name,
      address,
      userPhone,
      email,
      message,
      submitting,
      error,
      setName,
      setAddress,
      setUserPhone,
      setEmail,
      setMessage,
      setSubmitting,
      setError,
    },
    hasPlaces,
    autocompleteRef,
    areaId,
    sessionId,
  } = props;

  return (
    <div
      className="fixed inset-0 z-40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="enquiry-title"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-0 z-50 flex sm:items-center sm:justify-center sm:p-6">
        <div className="relative w-full sm:max-w-xl bg-white shadow-xl ring-1 ring-black/10 sm:rounded-2xl sm:max-h-[calc(100vh-4rem)] h-[100dvh] sm:h-auto rounded-none sm:rounded-2xl flex flex-col overflow-hidden">
          {/* Sticky header */}
          <div className="sticky top-0 z-10 bg-white border-b border-black/5">
            <div className="p-4 sm:p-6 flex items-start justify-between gap-4">
              <div>
                <h2 id="enquiry-title" className="text-lg sm:text-xl font-bold">
                  Message {cleaner.business_name}
                </h2>
                <p className="text-sm text-night-700 mt-1">
                  Fill in your details and choose how to send your enquiry.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-black/5"
                aria-label="Close"
              >
                <span className="text-xl leading-none">×</span>
              </button>
            </div>
          </div>

          {/* Scrollable content */}
          <form
            className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4"
            onSubmit={(e) => e.preventDefault()}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-11 rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Your full name"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Phone</label>
                <input
                  type="tel"
                  value={userPhone}
                  onChange={(e) => setUserPhone(e.target.value)}
                  className="h-11 rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="07… or +44…"
                />
              </div>

              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-sm font-medium">Address</label>
                {hasPlaces ? (
                  <Autocomplete
                    onLoad={(ac) => (autocompleteRef.current = ac)}
                    onPlaceChanged={() => {
                      try {
                        const p = autocompleteRef.current?.getPlace?.();
                        const value = p?.formatted_address || p?.name || "";
                        if (value) setAddress(value);
                      } catch {
                        /* noop */
                      }
                    }}
                  >
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="h-11 rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/50"
                      placeholder="Start typing your address…"
                      autoComplete="street-address"
                    />
                  </Autocomplete>
                ) : (
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="h-11 rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/50"
                    placeholder="House no., street, town, postcode"
                    autoComplete="street-address"
                  />
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="you@example.com"
                />
              </div>

              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-sm font-medium">Enquiry</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="min-h[110px] min-h-[110px] rounded-xl border border-black/10 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Tell us about your bins, frequency, and any access notes…"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
          </form>

          {/* Sticky footer */}
          <div className="sticky bottom-0 z-10 bg-white border-t border-black/5 px-4 sm:px-6 py-3 pb-[calc(env(safe-area-inset-bottom,0)+12px)]">
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              {props.isMobile && cleaner.whatsapp && (
                <a
                  href={buildWhatsAppUrl(cleaner.whatsapp, {
                    business: cleaner.business_name,
                    name,
                    address,
                    email,
                    phone: userPhone,
                    message,
                  })}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-full h-11 px-5 text-sm font-semibold bg-[#25D366] text-white hover:bg-[#20bd59]"
                  onClick={() => {
                    logClick("click_message");
                  }}
                >
                  Send via WhatsApp
                </a>
              )}

              <button
                type="button"
                disabled={!!submitting}
                onClick={async () => {
                  setError(null);
                  if (!name.trim()) return setError("Please add your name.");
                  if (!message.trim()) return setError("Please add a short message.");

                  // record Email message click
                  logClick("click_message");

                  try {
                    setSubmitting("email");
                    const payload: EnquiryPayload = {
                      cleanerId: cleaner.id,
                      cleanerName: cleaner.business_name,
                      channels: ["email"],
                      name,
                      address,
                      phone: userPhone,
                      email,
                      message,
                    };
                    if (onSendEnquiry) await onSendEnquiry(payload);
                    else await defaultSendEmail(payload, emailEndpoint);
                    onClose();
                  } catch (e: any) {
                    setError(e?.message || "Sorry, sending failed. Please try again.");
                  } finally {
                    setSubmitting(null);
                  }
                }}
                className="inline-flex items-center justify-center rounded-full h-11 px-5 text-sm font-semibold bg-[#1D4ED8] text-white hover:bg-[#1741b5] disabled:opacity-60"
              >
                {submitting === "email" ? "Sending…" : "Send via Email"}
              </button>
            </div>
            <p className="text-xs text-night-600 pt-2">
              We’ll include your details in the message so {cleaner.business_name} can reply.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */
function detectIsMobile() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const touchPoints = (navigator as any).maxTouchPoints || 0;
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const mobileUA = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua);
  const iPadOS = /Macintosh/.test(ua) && touchPoints > 1; // iPadOS 13+ Safari
  return mobileUA || iPadOS || coarse;
}

function digitsOnly(s: string) {
  return s.replace(/[^\d+]/g, "");
}
function normalizeWhatsApp(input: string) {
  if (input.startsWith("http")) return input;
  const d = digitsOnly(input);
  const noPlus = d.startsWith("+") ? d.slice(1) : d;
  return `https://wa.me/${noPlus}`;
}
function normalizeWebsite(raw: string) {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url;
}
function prettyPhone(p?: string) {
  if (!p) return "";
  const d = digitsOnly(p);
  if (d.startsWith("+44")) return "+44 " + d.slice(3).replace(/(\d{4})(\d{3})(\d{3})/, "$1 $2 $3");
  if (d.length === 11 && d.startsWith("0")) return d.replace(/(\d{5})(\d{3})(\d{3})/, "$1 $2 $3");
  return p;
}
function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function buildWhatsAppUrl(
  wa: string,
  data: { business: string; name: string; address: string; phone: string; email: string; message: string }
) {
  const base = normalizeWhatsApp(wa);
  const text =
    `Enquiry for ${data.business}\n` +
    `Name: ${data.name || "-"}\n` +
    `Address: ${data.address || "-"}\n` +
    `Phone: ${data.phone || "-"}\n` +
    `Email: ${data.email || "-"}\n\n` +
    `${data.message || ""}`;
  const encoded = encodeURIComponent(text);
  return `${base}?text=${encoded}`;
}

async function defaultSendEmail(payload: EnquiryPayload, endpoint?: string) {
  const url = endpoint || "/.netlify/functions/sendEnquiry";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error("Email service not configured on the server.");
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const j = await res.json().catch(() => null);
      throw new Error(j?.error || "Email sending failed.");
    }
    const msg = await safeErrorText(res);
    throw new Error(msg || "Email sending failed.");
  }
}

async function safeErrorText(res: Response) {
  try {
    const t = await res.text();
    return t.replace(/<[^>]*>/g, " ").trim().slice(0, 200);
  } catch {
    return "";
  }
}
