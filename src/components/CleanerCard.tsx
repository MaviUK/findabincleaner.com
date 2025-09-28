*** a/src/components/CleanerCard.tsx
--- b/src/components/CleanerCard.tsx
@@
-// src/components/CleanerCard.tsx
-import { useMemo, useState } from "react";
+// src/components/CleanerCard.tsx
+import { useMemo, useRef, useState } from "react";
+import { Autocomplete } from "@react-google-maps/api";
 import { PaymentPill } from "./icons/payments";
 import { ServicePill } from "./icons/services";
 
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
+  /**
+   * Optional custom handler for sending the enquiry email.
+   * If provided, this will be called instead of the default Netlify endpoint.
+   */
+  onSendEnquiry?: (payload: EnquiryPayload) => Promise<void>;
+  /**
+   * Optional email endpoint (defaults to '/.netlify/functions/sendEnquiry').
+   * Ignored if onSendEnquiry is provided.
+   */
+  emailEndpoint?: string;
 };
 
-export default function CleanerCard({ cleaner, showPayments }: CleanerCardProps) {
-  const [showPhone, setShowPhone] = useState(false);
+type EnquiryPayload = {
+  cleanerId: string;
+  cleanerName: string;
+  channels: ("email" | "whatsapp")[];
+  name: string;
+  address: string;
+  phone: string;
+  email: string;
+  message: string;
+};
+
+export default function CleanerCard({
+  cleaner,
+  showPayments,
+  onSendEnquiry,
+  emailEndpoint,
+}: CleanerCardProps) {
+  const [showPhone, setShowPhone] = useState(false);
+  const [showEnquiry, setShowEnquiry] = useState(false);
+  const [submitting, setSubmitting] = useState<null | "email" | "both">(null);
+
+  // Enquiry form state
+  const [name, setName] = useState("");
+  const [address, setAddress] = useState("");
+  const [phone, setPhone] = useState("");
+  const [email, setEmail] = useState("");
+  const [message, setMessage] = useState("");
+  const [error, setError] = useState<string | null>(null);
+
+  // Autocomplete ref (typed as any to avoid TS dependency on @types/google.maps)
+  const autocompleteRef = useRef<any>(null);
 
   const contactUrl = useMemo(() => {
     if (cleaner.whatsapp) return normalizeWhatsApp(cleaner.whatsapp);
     if (cleaner.phone) return `tel:${digitsOnly(cleaner.phone)}`;
     return undefined;
   }, [cleaner.whatsapp, cleaner.phone]);
@@
   return (
     <div className="bg-white text-night-900 rounded-xl shadow-soft border border-black/5 p-4 sm:p-5">
       {/* Full-height row so logo + content + buttons align top/bottom */}
       <div className="flex items-stretch gap-5">
         {/* Left: logo panel + content */}
         <div className="flex items-stretch gap-5 flex-1 min-w-0">
@@
         </div>
 
         {/* Right: stacked actions, centered vertically & right-aligned */}
         <div className="self-stretch flex flex-col items-end justify-center gap-1 sm:gap-2 shrink-0">
-          {contactUrl && (
-            <a
-              href={contactUrl}
-              target={contactUrl.startsWith("http") ? "_blank" : undefined}
-              rel="noreferrer"
-              className="inline-flex items-center justify-center rounded-full h-10 w-40 text-sm font-semibold bg-[#F44336] text-white hover:bg-[#E53935]"
-            >
-              Message
-            </a>
-          )}
+          <button
+            type="button"
+            onClick={() => setShowEnquiry(true)}
+            className="inline-flex items-center justify-center rounded-full h-10 w-40 text-sm font-semibold bg-[#F44336] text-white hover:bg-[#E53935] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#F44336]/60"
+          >
+            Message
+          </button>
 
           {/* Phone button: toggles to show number inside the same control */}
           {cleaner.phone && (
             <>
               {!showPhone ? (
@@
           )}
         </div>
       </div>
+
+      {/* Enquiry Modal */}
+      {showEnquiry && (
+        <div
+          className="fixed inset-0 z-40"
+          aria-labelledby="enquiry-title"
+          role="dialog"
+          aria-modal="true"
+        >
+          <div className="absolute inset-0 bg-black/40" onClick={() => setShowEnquiry(false)} />
+          <div className="absolute inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
+            <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl ring-1 ring-black/10">
+              <div className="p-4 sm:p-6 border-b border-black/5">
+                <div className="flex items-start justify-between gap-4">
+                  <div>
+                    <h2 id="enquiry-title" className="text-lg sm:text-xl font-bold">
+                      Message {cleaner.business_name}
+                    </h2>
+                    <p className="text-sm text-night-700 mt-1">
+                      Fill in your details and choose how to send your enquiry.
+                    </p>
+                  </div>
+                  <button
+                    type="button"
+                    onClick={() => setShowEnquiry(false)}
+                    className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-black/5"
+                    aria-label="Close"
+                  >
+                    <span className="text-xl leading-none">×</span>
+                  </button>
+                </div>
+              </div>
+
+              <form
+                className="p-4 sm:p-6 space-y-4"
+                onSubmit={(e) => {
+                  // Prevent implicit submit; user picks a channel button.
+                  e.preventDefault();
+                }}
+              >
+                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
+                  <div className="flex flex-col gap-1.5">
+                    <label className="text-sm font-medium">Name</label>
+                    <input
+                      type="text"
+                      value={name}
+                      onChange={(e) => setName(e.target.value)}
+                      className="h-11 rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/50"
+                      placeholder="Your full name"
+                      required
+                    />
+                  </div>
+                  <div className="flex flex-col gap-1.5">
+                    <label className="text-sm font-medium">Phone</label>
+                    <input
+                      type="tel"
+                      value={phone}
+                      onChange={(e) => setPhone(e.target.value)}
+                      className="h-11 rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/50"
+                      placeholder="07… or +44…"
+                    />
+                  </div>
+                  <div className="flex flex-col gap-1.5 sm:col-span-2">
+                    <label className="text-sm font-medium">Address</label>
+                    <Autocomplete
+                      onLoad={(ac) => (autocompleteRef.current = ac)}
+                      onPlaceChanged={() => {
+                        const p = autocompleteRef.current?.getPlace?.();
+                        const value = p?.formatted_address || p?.name || "";
+                        if (value) setAddress(value);
+                      }}
+                    >
+                      <input
+                        type="text"
+                        value={address}
+                        onChange={(e) => setAddress(e.target.value)}
+                        className="h-11 rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/50"
+                        placeholder="Start typing your address…"
+                        autoComplete="street-address"
+                      />
+                    </Autocomplete>
+                  </div>
+                  <div className="flex flex-col gap-1.5">
+                    <label className="text-sm font-medium">Email</label>
+                    <input
+                      type="email"
+                      value={email}
+                      onChange={(e) => setEmail(e.target.value)}
+                      className="h-11 rounded-xl border border-black/10 px-3 outline-none focus:ring-2 focus:ring-blue-500/50"
+                      placeholder="you@example.com"
+                    />
+                  </div>
+                  <div className="flex flex-col gap-1.5 sm:col-span-2">
+                    <label className="text-sm font-medium">Enquiry</label>
+                    <textarea
+                      value={message}
+                      onChange={(e) => setMessage(e.target.value)}
+                      className="min-h-[110px] rounded-xl border border-black/10 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500/50"
+                      placeholder="Tell us about your bins, frequency, and any access notes…"
+                      required
+                    />
+                  </div>
+                </div>
+
+                {error && (
+                  <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
+                    {error}
+                  </div>
+                )}
+
+                <div className="pt-1 flex flex-col sm:flex-row gap-2 sm:gap-3">
+                  {cleaner.whatsapp && (
+                    <a
+                      href={buildWhatsAppUrl(cleaner.whatsapp, {
+                        business: cleaner.business_name,
+                        name,
+                        address,
+                        email,
+                        phone,
+                        message,
+                      })}
+                      target="_blank"
+                      rel="noreferrer"
+                      className="inline-flex items-center justify-center rounded-full h-11 px-5 text-sm font-semibold bg-[#25D366] text-white hover:bg-[#20bd59]"
+                      onClick={() => setShowEnquiry(false)}
+                    >
+                      Send via WhatsApp
+                    </a>
+                  )}
+                  <button
+                    type="button"
+                    disabled={!!submitting}
+                    onClick={async () => {
+                      setError(null);
+                      if (!name.trim()) {
+                        setError("Please add your name.");
+                        return;
+                      }
+                      if (!message.trim()) {
+                        setError("Please add a short message.");
+                        return;
+                      }
+                      try {
+                        setSubmitting("email");
+                        const payload: EnquiryPayload = {
+                          cleanerId: cleaner.id,
+                          cleanerName: cleaner.business_name,
+                          channels: ["email"],
+                          name,
+                          address,
+                          phone,
+                          email,
+                          message,
+                        };
+                        if (onSendEnquiry) {
+                          await onSendEnquiry(payload);
+                        } else {
+                          await defaultSendEmail(payload, emailEndpoint);
+                        }
+                        setShowEnquiry(false);
+                      } catch (e) {
+                        setError(
+                          e instanceof Error ? e.message : "Sorry, sending failed. Please try again."
+                        );
+                      } finally {
+                        setSubmitting(null);
+                      }
+                    }}
+                    className="inline-flex items-center justify-center rounded-full h-11 px-5 text-sm font-semibold bg-[#1D4ED8] text-white hover:bg-[#1741b5] disabled:opacity-60"
+                  >
+                    {submitting === "email" ? "Sending…" : "Send via Email"}
+                  </button>
+                  {cleaner.whatsapp && (
+                    <button
+                      type="button"
+                      disabled={!!submitting}
+                      onClick={async () => {
+                        setError(null);
+                        if (!name.trim()) {
+                          setError("Please add your name.");
+                          return;
+                        }
+                        if (!message.trim()) {
+                          setError("Please add a short message.");
+                          return;
+                        }
+                        try {
+                          setSubmitting("both");
+                          const payload: EnquiryPayload = {
+                            cleanerId: cleaner.id,
+                            cleanerName: cleaner.business_name,
+                            channels: ["email", "whatsapp"],
+                            name,
+                            address,
+                            phone,
+                            email,
+                            message,
+                          };
+                          if (onSendEnquiry) {
+                            await onSendEnquiry(payload);
+                          } else {
+                            await defaultSendEmail(payload, emailEndpoint);
+                          }
+                          const href = buildWhatsAppUrl(cleaner.whatsapp!, {
+                            business: cleaner.business_name,
+                            name,
+                            address,
+                            email,
+                            phone,
+                            message,
+                          });
+                          window.open(href, "_blank", "noopener,noreferrer");
+                          setShowEnquiry(false);
+                        } catch (e) {
+                          setError(
+                            e instanceof Error
+                              ? e.message
+                              : "Sorry, sending failed. Please try again."
+                          );
+                        } finally {
+                          setSubmitting(null);
+                        }
+                      }}
+                      className="inline-flex items-center justify-center rounded-full h-11 px-5 text-sm font-semibold bg-black text-white hover:bg-black/90 disabled:opacity-60"
+                    >
+                      {submitting === "both" ? "Sending…" : "Send Both"}
+                    </button>
+                  )}
+                </div>
+                <p className="text-xs text-night-600 pt-1">
+                  We’ll include your details in the message so {cleaner.business_name} can reply.
+                </p>
+              </form>
+            </div>
+          </div>
+        </div>
+      )}
     </div>
   );
 }
 
 /* ---------- helpers ---------- */
 function slugify(s?: string) {
   return (s || "").toLowerCase().replace(/\s+/g, "_").replace(/[^\w-]/g, "");
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
+
+function buildWhatsAppUrl(
+  wa: string,
+  data: {
+    business: string;
+    name: string;
+    address: string;
+    phone: string;
+    email: string;
+    message: string;
+  }
+) {
+  const base = normalizeWhatsApp(wa);
+  const text =
+    `Enquiry for ${data.business}\n` +
+    `Name: ${data.name || "-"}\n` +
+    `Address: ${data.address || "-"}\n` +
+    `Phone: ${data.phone || "-"}\n` +
+    `Email: ${data.email || "-"}\n\n` +
+    `${data.message || ""}`;
+  const url = new URL(base);
+  url.searchParams.set("text", text);
+  return url.toString();
+}
+
+async function defaultSendEmail(payload: EnquiryPayload, endpoint?: string) {
+  const url = endpoint || "/.netlify/functions/sendEnquiry";
+  const res = await fetch(url, {
+    method: "POST",
+    headers: { "Content-Type": "application/json" },
+    body: JSON.stringify(payload),
+  });
+  if (!res.ok) {
+    const msg = await safeErrorText(res);
+    throw new Error(msg || "Email sending failed.");
+  }
+}
+
+async function safeErrorText(res: Response) {
+  try {
+    const t = await res.text();
+    return t?.slice(0, 400);
+  } catch {
+    return "";
+  }
+}
