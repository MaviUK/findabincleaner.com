// src/components/CleanerCard.tsx
import { useMemo, useRef, useState } from "react";
import { Autocomplete } from "@react-google-maps/api";
import { getOrCreateSessionId, recordEventFetch } from "../lib/analytics";

type Cleaner = {
  cleaner_id: string;
  business_name: string | null;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
  whatsapp?: string | null;
  email?: string | null;

  // carried through from FindCleaners
  area_id?: string | null;
  area_name?: string | null;
  category_id?: string | null;

  is_covering_sponsor?: boolean;
  distance_m?: number | null;
};

type Props = {
  cleaner: Cleaner;
  postcodeHint?: string;

  // keep compatibility with existing callers (ResultsList / Settings)
  showPayments?: boolean;

  // analytics attribution
  areaId?: string | null;
  categoryId?: string | null;
  position?: number;
};

function normalizeUrl(u: string) {
  const trimmed = (u || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function digitsOnly(s: string) {
  return String(s || "").replace(/[^\d]/g, "");
}

function waLink(whatsappRaw: string, text: string) {
  const digits = digitsOnly(whatsappRaw);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function isEmailValid(v: string) {
  return /^\S+@\S+\.\S+$/.test(v.trim());
}

/* -------------------- Inline SVG icons (no lucide-react) -------------------- */
function IconMessage({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M21 12c0 4.418-4.03 8-9 8a10.8 10.8 0 0 1-3.4-.54L3 21l1.7-4.2A7.4 7.4 0 0 1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPhone({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M22 16.9v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.72c.12.86.3 1.7.54 2.5a2 2 0 0 1-.45 2.11L8 9.5a16 16 0 0 0 6 6l1.17-1.19a2 2 0 0 1 2.11-.45c.8.24 1.64.42 2.5.54A2 2 0 0 1 22 16.9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconGlobe({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M2 12h20" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2c2.5 2.7 4 6.2 4 10s-1.5 7.3-4 10c-2.5-2.7-4-6.2-4-10s1.5-7.3 4-10Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

/* -------------------------------- Component -------------------------------- */
export default function CleanerCard({
  cleaner,
  postcodeHint,
  showPayments, // intentionally unused (compat prop)
  areaId,
  categoryId,
  position,
}: Props) {
  const [showModal, setShowModal] = useState(false);

  const websiteHref = useMemo(() => {
    if (!cleaner.website) return "";
    return normalizeUrl(cleaner.website);
  }, [cleaner.website]);

  async function log(event: any, meta?: Record<string, any>) {
    const session_id = getOrCreateSessionId();
    try {
      await recordEventFetch({
  event,
  cleanerId: cleaner.cleaner_id,
  areaId: areaId ?? cleaner.area_id ?? null,
  categoryId: categoryId ?? cleaner.category_id ?? null,
  sessionId: session_id,
  meta: {
    position: position ?? null,
    ...meta,
  },
});

    } catch {
      // ignore
    }
  }

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="h-14 w-14 rounded-xl overflow-hidden bg-black/5 grid place-items-center shrink-0">
          {cleaner.logo_url ? (
            <img
              src={cleaner.logo_url}
              alt={`${cleaner.business_name ?? "Cleaner"} logo`}
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="font-semibold text-lg">
              {(cleaner.business_name ?? "C").charAt(0)}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="font-bold text-lg truncate">
            {cleaner.business_name ?? "Cleaner"}
          </div>
          {cleaner.area_name ? (
            <div className="text-sm text-black/60 truncate">{cleaner.area_name}</div>
          ) : null}
        </div>

        {/* 3 icon buttons horizontally */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              log("click_message");
              setShowModal(true);
            }}
            className="h-10 w-10 rounded-full grid place-items-center bg-black text-white hover:bg-black/85"
            aria-label="Message"
            title="Message"
          >
            <IconMessage className="h-5 w-5" />
          </button>

          {cleaner.phone ? (
            <a
              href={`tel:${cleaner.phone}`}
              onClick={() => log("click_phone")}
              className="h-10 w-10 rounded-full grid place-items-center border border-black/10 bg-white hover:bg-black/5"
              aria-label="Call"
              title="Call"
            >
              <IconPhone className="h-5 w-5" />
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="h-10 w-10 rounded-full grid place-items-center border border-black/10 bg-white opacity-40 cursor-not-allowed"
              aria-label="Call disabled"
              title="No phone number"
            >
              <IconPhone className="h-5 w-5" />
            </button>
          )}

          {websiteHref ? (
            <button
              type="button"
              onClick={() => {
                log("click_website");
                window.open(websiteHref, "_blank", "noopener,noreferrer");
              }}
              className="h-10 w-10 rounded-full grid place-items-center border border-black/10 bg-white hover:bg-black/5"
              aria-label="Website"
              title="Website"
            >
              <IconGlobe className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="h-10 w-10 rounded-full grid place-items-center border border-black/10 bg-white opacity-40 cursor-not-allowed"
              aria-label="Website disabled"
              title="No website"
            >
              <IconGlobe className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {showModal && (
        <MessageModal
          cleaner={cleaner}
          postcodeHint={postcodeHint}
          onClose={() => setShowModal(false)}
          onLog={log}
          areaId={areaId ?? cleaner.area_id ?? null}
          categoryId={categoryId ?? cleaner.category_id ?? null}
        />
      )}
    </div>
  );
}

/* ------------------------------ Message Modal ------------------------------ */
function MessageModal({
  cleaner,
  postcodeHint,
  onClose,
  onLog,
  areaId,
  categoryId,
}: {
  cleaner: Cleaner;
  postcodeHint?: string;
  onClose: () => void;
  onLog: (event: any, meta?: Record<string, any>) => Promise<void>;
  areaId: string | null;
  categoryId: string | null;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState(postcodeHint ?? "");
  const [enquiry, setEnquiry] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const autocompleteRef = useRef<any>(null);
  const hasPlaces = typeof window !== "undefined" && (window as any).google?.maps?.places;

  const valid =
    name.trim() &&
    phone.trim() &&
    email.trim() &&
    isEmailValid(email) &&
    address.trim() &&
    enquiry.trim();

  const cleanerName = cleaner.business_name ?? "Cleaner";
  const compiled = useMemo(() => {
    return [
      `Hi ${cleanerName},`,
      ``,
      `New enquiry from Find a Bin Cleaner:`,
      `Name: ${name.trim()}`,
      `Phone: ${phone.trim()}`,
      `Email: ${email.trim()}`,
      `Address: ${address.trim()}`,
      ``,
      `Enquiry:`,
      enquiry.trim(),
    ].join("\n");
  }, [cleanerName, name, phone, email, address, enquiry]);

  const canWhatsApp = !!(cleaner.whatsapp && digitsOnly(cleaner.whatsapp).length >= 8);
  const canEmail = !!(cleaner.email && cleaner.email.includes("@"));

  async function submitWhatsApp() {
    setErr(null);
    if (!valid) return setErr("Please fill in all fields (with a valid email).");
    if (!canWhatsApp) return setErr("This business has no WhatsApp number set.");

    await onLog("lead_whatsapp_open", {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      area_id: areaId,
      category_id: categoryId,
    });

    window.open(waLink(cleaner.whatsapp!, compiled), "_blank", "noopener,noreferrer");
    onClose();
  }

  async function submitEmail() {
    setErr(null);
    if (!valid) return setErr("Please fill in all fields (with a valid email).");
    if (!canEmail) return setErr("This business has no email address set.");

    setSending(true);
    try {
      await onLog("lead_email_submit", {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        area_id: areaId,
        category_id: categoryId,
      });

      const res = await fetch("/.netlify/functions/sendEnquiryEmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cleanerId: cleaner.cleaner_id,
          cleanerName: cleaner.business_name ?? "Cleaner",
          cleanerEmail: cleaner.email,
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          address: address.trim(),
          message: enquiry.trim(),
          channels: ["email"],
        }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || "Email send failed.");
      }

      onClose();
    } catch (e: any) {
      setErr(e?.message || "Email failed. Please try WhatsApp.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onMouseDown={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div className="font-semibold text-lg">Message {cleanerName}</div>
            <button
              type="button"
              onClick={onClose}
              className="h-9 w-9 rounded-lg hover:bg-black/5"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name" value={name} onChange={setName} />
              <Field label="Phone" value={phone} onChange={setPhone} />
              <Field label="Email" value={email} onChange={setEmail} type="email" />

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium mb-1">Address</label>
                {hasPlaces ? (
                  <Autocomplete
                    onLoad={(ac) => (autocompleteRef.current = ac)}
                    onPlaceChanged={() => {
                      try {
                        const p = autocompleteRef.current?.getPlace?.();
                        const v = p?.formatted_address || p?.name || "";
                        if (v) setAddress(v);
                      } catch {
                        // ignore
                      }
                    }}
                  >
                    <input
                      className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black/20"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Start typing your address…"
                    />
                  </Autocomplete>
                ) : (
                  <input
                    className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black/20"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="House, street, town, postcode"
                  />
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Enquiry</label>
              <textarea
                className="w-full rounded-xl border px-3 py-2 min-h-[110px] focus:outline-none focus:ring-2 focus:ring-black/20"
                value={enquiry}
                onChange={(e) => setEnquiry(e.target.value)}
                placeholder="What do you need cleaned? How many bins?"
              />
            </div>

            {err && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                {err}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              <button
                type="button"
                onClick={submitWhatsApp}
                disabled={!valid || !canWhatsApp}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold bg-black text-white disabled:opacity-40"
                title={!canWhatsApp ? "Cleaner has no WhatsApp set" : undefined}
              >
                <IconMessage className="h-5 w-5" />
                WhatsApp Submit
              </button>

              <button
                type="button"
                onClick={submitEmail}
                disabled={!valid || !canEmail || sending}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold border border-black/15 bg-white disabled:opacity-40"
                title={!canEmail ? "Cleaner has no email set" : undefined}
              >
                {sending ? "Sending…" : "Email Submit"}
              </button>
            </div>

            {!canWhatsApp && (
              <div className="text-xs text-black/60">
                This cleaner hasn’t added WhatsApp details yet.
              </div>
            )}
            {!canEmail && (
              <div className="text-xs text-black/60">
                This cleaner hasn’t added an email address yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input
        type={type}
        className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black/20"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
