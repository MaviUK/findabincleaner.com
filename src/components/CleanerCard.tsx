// src/components/CleanerCard.tsx
import { useEffect, useMemo, useState } from "react";
import { getOrCreateSessionId } from "../lib/analytics";
import * as Analytics from "../lib/analytics";

type Cleaner = {
  cleaner_id: string;
  business_name: string | null;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
  whatsapp?: string | null;

  rating_avg?: number | null;
  rating_count?: number | null;

  // carried through from FindCleaners
  area_id?: string | null;
  area_name?: string | null;
  category_id?: string | null;

  is_covering_sponsor?: boolean;
};

type Props = {
  cleaner: Cleaner;
  postcodeHint?: string;
  showPayments?: boolean;

  // explicitly passed so analytics never “loses” them
  areaId?: string | null;
  categoryId?: string | null;

  position?: number; // for meta
  featured?: boolean; // sponsored listing etc
};

function normalizeUrl(u: string) {
  const trimmed = (u || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return "https://" + trimmed;
}

function digitsOnly(p: string) {
  return (p || "").replace(/[^\d+]/g, "");
}

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua);
}

function buildWhatsAppUrl(whatsapp: string, text: string) {
  const raw = (whatsapp || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http")) return `${raw}?text=${encodeURIComponent(text)}`;

  const d = digitsOnly(raw);
  const noPlus = d.startsWith("+") ? d.slice(1) : d;
  return `https://wa.me/${noPlus}?text=${encodeURIComponent(text)}`;
}

export default function CleanerCard({
  cleaner,
  areaId = null,
  categoryId = null,
  position,
  featured,
}: Props) {
  const [showEnquiry, setShowEnquiry] = useState(false);

  // form
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionId = useMemo(() => getOrCreateSessionId(), []);
  const mobile = useMemo(() => isMobileDevice(), []);

  // ---- analytics (safe wrapper) ----
  const recordEventFetch = (Analytics as any).recordEventFetch as
    | ((payload: any) => Promise<any> | any)
    | undefined;

  function logEvent(event: "click_message" | "click_phone" | "click_website") {
    try {
      // keep this resilient — don’t hard-depend on a specific TS signature
      if (recordEventFetch) {
        recordEventFetch({
          cleaner_id: cleaner.cleaner_id,
          area_id: areaId ?? cleaner.area_id ?? null,
          category_id: categoryId ?? cleaner.category_id ?? null,
          event,
          position: typeof position === "number" ? position : null,
          featured: !!featured,
          session_id: sessionId,
        });
      }
    } catch {
      // swallow (analytics should never break UI)
    }
  }

  async function sendEnquiry() {
    setError(null);

    if (!name.trim()) return setError("Please enter your name.");
    if (!message.trim()) return setError("Please enter your message.");

    setSubmitting(true);
    try {
      const payload = {
        cleanerId: cleaner.cleaner_id,
        cleanerName: cleaner.business_name ?? "",
        name,
        address,
        phone: contactNumber,
        email,
        message,
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
      // optional: clear form after send
      setName("");
      setAddress("");
      setContactNumber("");
      setEmail("");
      setMessage("");
    } catch (e: any) {
      setError(e?.message || "Sorry — something went wrong sending your enquiry.");
    } finally {
      setSubmitting(false);
    }
  }

  const websiteHref = cleaner.website ? normalizeUrl(cleaner.website) : "";

  return (
    <>
      <div className="rounded-2xl bg-white shadow-soft border border-black/5 p-4 sm:p-5">
        <div className="flex gap-4">
          {/* Logo */}
          <div className="shrink-0">
            <div className="h-24 w-24 sm:h-28 sm:w-28 rounded-2xl overflow-hidden bg-white">
              {cleaner.logo_url ? (
                <img
                  src={cleaner.logo_url}
                  alt={`${cleaner.business_name ?? "Business"} logo`}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="h-full w-full bg-black/5 grid place-items-center text-xl font-bold">
                  {(cleaner.business_name || "C").slice(0, 1)}
                </div>
              )}
            </div>
          </div>

          {/* Info + actions */}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg sm:text-xl font-bold truncate">
                  {cleaner.business_name || "Business"}
                </div>

                {typeof cleaner.rating_avg === "number" && cleaner.rating_avg > 0 ? (
                  <div className="mt-1 text-sm text-night-700">
                    <span className="font-semibold">★ {cleaner.rating_avg.toFixed(1)}</span>{" "}
                    {typeof cleaner.rating_count === "number" ? (
                      <span className="text-night-600">({cleaner.rating_count} reviews)</span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* optional sponsor badge */}
              {featured ? (
                <span className="shrink-0 inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-xs font-semibold ring-1 ring-emerald-200">
                  Sponsored
                </span>
              ) : null}
            </div>

            {/* Buttons */}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full h-10 px-5 text-sm font-semibold bg-[#F44336] text-white hover:bg-[#E53935]"
                onMouseDown={() => logEvent("click_message")}
                onClick={() => setShowEnquiry(true)}
              >
                Message
              </button>

              {cleaner.phone ? (
                <a
                  className="inline-flex items-center justify-center rounded-full h-10 px-5 text-sm font-semibold bg-white text-[#0B1B2A] ring-1 ring-[#1D4ED8]/30 hover:ring-[#1D4ED8]/50"
                  href={`tel:${digitsOnly(cleaner.phone)}`}
                  onMouseDown={() => logEvent("click_phone")}
                >
                  Phone
                </a>
              ) : null}

              {websiteHref ? (
                <a
                  className="inline-flex items-center justify-center rounded-full h-10 px-5 text-sm font-semibold bg-white text-[#0B1B2A] ring-1 ring-black/10 hover:ring-black/20"
                  href={websiteHref}
                  target="_blank"
                  rel="noreferrer"
                  onMouseDown={() => logEvent("click_website")}
                >
                  Website
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Enquiry Modal (NiBinGuy-style) ---- */}
      {showEnquiry ? (
        <div className="fixed inset-0 z-50">
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowEnquiry(false)}
          />

          {/* centered modal */}
          <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-6">
            <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl ring-1 ring-black/10 overflow-hidden max-h-[calc(100vh-2rem)]">
              {/* Header */}
              <div className="px-5 pt-5 pb-3 border-b border-black/5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold truncate">
                      Enquiry to {cleaner.business_name || "Business"}
                    </h2>
                    <p className="text-sm text-night-700 mt-1">
                      Fill this in and they’ll get back to you.
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

              {/* Body (scroll inside modal) */}
              <div
                className="px-5 py-4 space-y-4 overflow-y-auto"
                style={{ maxHeight: "calc(100vh - 210px)" }}
              >
                <Field label="Your Name">
                  <input
                    className="h-11 w-full rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-[#1D4ED8]/35"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                  />
                </Field>

                <Field label="Address (optional)">
                  <input
                    className="h-11 w-full rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-[#1D4ED8]/35"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="House no, street, town, postcode"
                    autoComplete="street-address"
                  />
                </Field>

                <Field label="Contact Number (optional)">
                  <input
                    className="h-11 w-full rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-[#1D4ED8]/35"
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value)}
                    placeholder="07…"
                    autoComplete="tel"
                  />
                </Field>

                <Field label="Email (optional)">
                  <input
                    className="h-11 w-full rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-[#1D4ED8]/35"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </Field>

                <Field label="Your Message">
                  <textarea
                    className="min-h-[120px] w-full rounded-xl border border-black/10 px-3 py-2 outline-none focus:ring-2 focus:ring-[#1D4ED8]/35"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="What do you need? Bin type, frequency, any notes…"
                  />
                </Field>

                {error ? (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    {error}
                  </div>
                ) : null}
              </div>

              {/* Footer */}
              <div className="px-5 py-4 border-t border-black/5 bg-white">
                <div className="flex flex-col gap-2">
                  {mobile && cleaner.whatsapp ? (
                    <a
                      className="inline-flex items-center justify-center rounded-xl h-11 px-4 text-sm font-semibold bg-[#25D366] text-white hover:bg-[#20bd59]"
                      href={buildWhatsAppUrl(
                        cleaner.whatsapp,
                        `Enquiry for ${cleaner.business_name || "your business"}\n\nName: ${name || "-"}\nAddress: ${
                          address || "-"
                        }\nPhone: ${contactNumber || "-"}\nEmail: ${
                          email || "-"
                        }\n\n${message || ""}`
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Send via WhatsApp
                    </a>
                  ) : null}

                  <button
                    type="button"
                    onClick={sendEnquiry}
                    disabled={submitting}
                    className="inline-flex items-center justify-center rounded-xl h-11 px-4 text-sm font-semibold bg-[#1D4ED8] text-white hover:bg-[#1741b5] disabled:opacity-60"
                  >
                    {submitting ? "Sending…" : "Send Enquiry"}
                  </button>
                </div>

                <p className="text-xs text-night-600 pt-2">
                  This sends your enquiry to the cleaner.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-night-900">{label}</label>
      {children}
    </div>
  );
}
