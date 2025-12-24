import { useEffect, useMemo, useState } from "react";
import { X, MessageCircle, Mail } from "lucide-react";
import { getOrCreateSessionId, recordEventFetch } from "../lib/analytics";

type Cleaner = {
  cleaner_id: string;
  business_name: string | null;
  whatsapp?: string | null;
  email?: string | null; // make sure you pass this in from your query
  area_id?: string | null;
  category_id?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  cleaner: Cleaner;
  postcodeHint?: string;
  position?: number;
  areaId?: string | null;
  categoryId?: string | null;
};

function normalizePhone(input: string) {
  return input.replace(/[^\d+]/g, "").trim();
}

function buildWhatsAppUrl(whatsappRaw: string, text: string) {
  // WhatsApp expects digits only (no +)
  const digits = whatsappRaw.replace(/[^\d]/g, "");
  const encoded = encodeURIComponent(text);
  return `https://wa.me/${digits}?text=${encoded}`;
}

export default function MessageCleanerModal({
  open,
  onClose,
  cleaner,
  postcodeHint,
  position,
  areaId,
  categoryId,
}: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [emailFromUser, setEmailFromUser] = useState("");
  const [address, setAddress] = useState(postcodeHint ?? "");
  const [enquiry, setEnquiry] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);

  // reset when opening
  useEffect(() => {
    if (!open) return;
    setName("");
    setPhone("");
    setEmailFromUser("");
    setAddress(postcodeHint ?? "");
    setEnquiry("");
  }, [open, postcodeHint]);

  const cleanerName = cleaner.business_name ?? "this cleaner";

  const cleanerWhatsapp = useMemo(() => {
    const w = cleaner.whatsapp?.trim() || "";
    return w ? normalizePhone(w) : "";
  }, [cleaner.whatsapp]);

  const cleanerEmail = useMemo(() => {
    const e = cleaner.email?.trim() || "";
    return e;
  }, [cleaner.email]);

  const canWhatsApp = !!cleanerWhatsapp;
  const canEmail = !!cleanerEmail;

  const valid = useMemo(() => {
    if (!name.trim()) return false;
    if (!phone.trim()) return false;
    if (!emailFromUser.trim()) return false;
    if (!address.trim()) return false;
    if (!enquiry.trim()) return false;
    // basic email check
    if (!/^\S+@\S+\.\S+$/.test(emailFromUser.trim())) return false;
    return true;
  }, [name, phone, emailFromUser, address, enquiry]);

  const compiledMessage = useMemo(() => {
    return [
      `Hi ${cleanerName},`,
      ``,
      `New enquiry from FindABinCleaner:`,
      `Name: ${name.trim()}`,
      `Phone: ${phone.trim()}`,
      `Email: ${emailFromUser.trim()}`,
      `Address: ${address.trim()}`,
      ``,
      `Enquiry:`,
      enquiry.trim(),
    ].join("\n");
  }, [cleanerName, name, phone, emailFromUser, address, enquiry]);

  function backdropClose(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  async function submitWhatsApp() {
    if (!valid) return;

    const session_id = getOrCreateSessionId();
    await recordEventFetch("LEAD_WHATSAPP_OPEN", {
      cleaner_id: cleaner.cleaner_id,
      area_id: areaId ?? cleaner.area_id ?? null,
      category_id: categoryId ?? cleaner.category_id ?? null,
      position: position ?? null,
      meta: {
        name: name.trim(),
        phone: phone.trim(),
        email: emailFromUser.trim(),
        address: address.trim(),
      },
      session_id,
      uniq: `lead_wa_${cleaner.cleaner_id}_${session_id}_${Date.now()}`,
    });

    const url = buildWhatsAppUrl(cleanerWhatsapp, compiledMessage);
    window.open(url, "_blank", "noopener,noreferrer");
    onClose();
  }

  async function submitEmail() {
    if (!valid || !canEmail) return;

    setSendingEmail(true);
    try {
      const session_id = getOrCreateSessionId();

      await recordEventFetch("LEAD_EMAIL_SUBMIT", {
        cleaner_id: cleaner.cleaner_id,
        area_id: areaId ?? cleaner.area_id ?? null,
        category_id: categoryId ?? cleaner.category_id ?? null,
        position: position ?? null,
        meta: {
          name: name.trim(),
          phone: phone.trim(),
          email: emailFromUser.trim(),
          address: address.trim(),
          enquiry: enquiry.trim(),
          to: cleanerEmail,
        },
        session_id,
        uniq: `lead_email_${cleaner.cleaner_id}_${session_id}_${Date.now()}`,
      });

      const res = await fetch("/api/sendLeadEmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: cleanerEmail,
          cleaner_id: cleaner.cleaner_id,
          cleaner_name: cleaner.business_name ?? null,
          lead: {
            name: name.trim(),
            phone: phone.trim(),
            email: emailFromUser.trim(),
            address: address.trim(),
            enquiry: enquiry.trim(),
          },
          context: {
            area_id: areaId ?? cleaner.area_id ?? null,
            category_id: categoryId ?? cleaner.category_id ?? null,
            position: position ?? null,
          },
        }),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      onClose();
    } catch (e) {
      console.error(e);
      alert("Email failed to send. Please try WhatsApp instead.");
    } finally {
      setSendingEmail(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onMouseDown={backdropClose}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="font-semibold text-lg">
            Message {cleaner.business_name ?? "Cleaner"}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-black/5"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Name" value={name} onChange={setName} />
            <Field label="Phone" value={phone} onChange={setPhone} />
            <Field
              label="Email"
              value={emailFromUser}
              onChange={setEmailFromUser}
              type="email"
            />
            <Field label="Address" value={address} onChange={setAddress} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Enquiry</label>
            <textarea
              className="w-full rounded-xl border px-3 py-2 min-h-[110px] focus:outline-none focus:ring-2 focus:ring-black/20"
              value={enquiry}
              onChange={(e) => setEnquiry(e.target.value)}
              placeholder="What do you need done? e.g. 2 wheelie bins, weekly, etc."
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <button
              onClick={submitWhatsApp}
              disabled={!valid || !canWhatsApp}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold bg-black text-white disabled:opacity-40"
              title={!canWhatsApp ? "Cleaner has no WhatsApp set" : undefined}
            >
              <MessageCircle className="w-5 h-5" />
              WhatsApp Submit
            </button>

            <button
              onClick={submitEmail}
              disabled={!valid || !canEmail || sendingEmail}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold border border-black/15 bg-white disabled:opacity-40"
              title={!canEmail ? "Cleaner has no email set" : undefined}
            >
              <Mail className="w-5 h-5" />
              {sendingEmail ? "Sending..." : "Email Submit"}
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
