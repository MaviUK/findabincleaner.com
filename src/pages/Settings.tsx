// src/pages/Settings.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Cleaner = {
  id: string;
  user_id: string;
  business_name: string | null;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  about: string | null;
  contact_email: string | null;
  payment_methods?: string[] | null;
  service_types?: string[] | null; // NEW
};

// emoji placeholders (easy to swap to SVG later)
const PAYMENT_METHODS: { key: string; label: string; icon: string }[] = [
  { key: "bank_transfer", label: "Bank Transfer", icon: "🏦" },
  { key: "cash", label: "Cash", icon: "💵" },
  { key: "stripe", label: "Stripe", icon: "🟦" },
  { key: "gocardless", label: "GoCardless", icon: "🔵" },
  { key: "paypal", label: "PayPal", icon: "🅿️" },
  { key: "card_machine", label: "Card Machine", icon: "💳" },
];

// NEW: service types
const SERVICE_TYPES: { key: string; label: string; icon: string }[] = [
  { key: "domestic", label: "Domestic", icon: "🏠" },
  { key: "commercial", label: "Commercial", icon: "🏢" },
];

// Resize an image file to a centered, covered 300x300 PNG
async function resizeTo300PNG(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });

    const size = 300;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const scale = Math.max(size / img.width, size / img.height);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const dx = Math.floor((size - w) / 2);
    const dy = Math.floor((size - h) / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, dx, dy, w, h);
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png", 0.92)
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function PaymentMethodsSelector({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (key: string, checked: boolean) => {
    const set = new Set(value);
    checked ? set.add(key) : set.delete(key);
    onChange(Array.from(set));
  };
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Payment methods accepted</div>
      <div className="flex flex-wrap gap-2">
        {PAYMENT_METHODS.map((m) => {
          const checked = value.includes(m.key);
          return (
            <label
              key={m.key}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm cursor-pointer select-none transition
                ${checked ? "bg-black text-white border-black" : "bg-white hover:bg-gray-50 border-gray-300"}`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={(e) => toggle(m.key, e.target.checked)}
              />
              <span className="text-base leading-none">{m.icon}</span>
              <span>{m.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// NEW: Service Types selector
function ServiceTypesSelector({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (key: string, checked: boolean) => {
    const set = new Set(value);
    checked ? set.add(key) : set.delete(key);
    onChange(Array.from(set));
  };
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Service types</div>
      <div className="flex flex-wrap gap-2">
        {SERVICE_TYPES.map((s) => {
          const checked = value.includes(s.key);
          return (
            <label
              key={s.key}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm cursor-pointer select-none transition
                ${checked ? "bg-black text-white border-black" : "bg-white hover:bg-gray-50 border-gray-300"}`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={(e) => toggle(s.key, e.target.checked)}
              />
              <span className="text-base leading-none">{s.icon}</span>
              <span>{s.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function Settings() {
  const [userId, setUserId] = useState<string | null>(null);
  const [cleaner, setCleaner] = useState<Cleaner | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // form fields
  const [businessName, setBusinessName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [about, setAbout] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [serviceTypes, setServiceTypes] = useState<string[]>([]); // NEW

  // logo state
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [resizedLogo, setResizedLogo] = useState<Blob | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          window.location.hash = "#/login";
          return;
        }
        setUserId(user.id);

        // load the existing cleaner row
        const { data, error } = await supabase
          .from("cleaners")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle(); // do NOT create or change data during load
        if (error) throw error;

        if (!data) {
          // leave the form empty but prefill email; don't insert on load
          fillForm(
            {
              id: "",
              user_id: user.id,
              business_name: null,
              logo_url: null,
              address: null,
              phone: null,
              website: null,
              about: null,
              contact_email: user.email ?? null,
              payment_methods: [],
              service_types: [], // NEW
            },
            user.email ?? ""
          );
        } else {
          fillForm(data as Cleaner, user.email ?? "");
        }
      } catch (e: any) {
        setErr(e.message || "Failed to load profile.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function fillForm(c: Cleaner, fallbackEmail: string) {
    setCleaner(c);
    setBusinessName(c.business_name ?? "");
    setAddress(c.address ?? "");
    setPhone(c.phone ?? "");
    setWebsite(c.website ?? "");
    setAbout(c.about ?? "");
    setContactEmail(c.contact_email ?? fallbackEmail ?? "");
    setLogoPreview(c.logo_url ?? null);
    setPaymentMethods(Array.isArray(c.payment_methods) ? (c.payment_methods as string[]) : []);
    setServiceTypes(Array.isArray(c.service_types) ? (c.service_types as string[]) : []); // NEW
  }

  async function ensureRow(): Promise<string> {
    // create a row only when user clicks Save and none exists
    if (cleaner && cleaner.id) return cleaner.id;
    const { data: created, error } = await supabase
      .from("cleaners")
      .insert({
        user_id: userId,
        business_name: businessName || null,
        address: address || null,
        phone: phone || null,
        website: website || null,
        about: about || null,
        contact_email: contactEmail || null,
        payment_methods: paymentMethods,
        service_types: serviceTypes, // NEW
      })
      .select("id,*")
      .single();
    if (error) throw error;
    setCleaner(created as Cleaner);
    return created.id as string;
  }

  async function uploadLogoIfAny(): Promise<string | null> {
    if (!logoFile || !userId) return logoPreview || null;
    const png = resizedLogo ?? (await resizeTo300PNG(logoFile));
    const path = `${userId}/logo.png`;
    const { error: upErr } = await supabase.storage
      .from("logos")
      .upload(path, png, { upsert: true, cacheControl: "3600", contentType: "image/png" });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from("logos").getPublicUrl(path);
    return data.publicUrl;
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const id = await ensureRow();
      const newLogo = await uploadLogoIfAny();

      const payload: Partial<Cleaner> & {
        payment_methods?: string[];
        service_types?: string[];
      } = {
        business_name: businessName || null,
        address: address || null,
        phone: phone || null,
        website: website || null,
        about: about || null,
        contact_email: contactEmail || null,
        logo_url: newLogo ?? logoPreview ?? null,
        payment_methods: paymentMethods,
        service_types: serviceTypes, // NEW
      };

      const { error } = await supabase.from("cleaners").update(payload).eq("id", id);
      if (error) throw error;

      setCleaner((prev) => (prev ? { ...prev, ...payload, id } as Cleaner : prev));
      if (newLogo) setLogoPreview(newLogo);
      setLogoFile(null);
      setResizedLogo(null);
      setMsg("Settings saved.");
    } catch (e: any) {
      setErr(e.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const canSave = useMemo(() => businessName.trim().length > 0, [businessName]);

  if (loading)
    return (
      <main className="container mx-auto max-w-5xl px-4 py-8">Loading…</main>
    );

  return (
    <main className="container mx-auto max-w-5xl px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold">Profile</h1>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* LEFT: Edit form */}
        <section className="space-y-3 p-4 border rounded-2xl bg-white">
          <label className="block">
            <span className="text-sm">Business name</span>
            <input
              className="w-full border rounded px-3 py-2"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. NI Bin Guy"
            />
          </label>

          <label className="block">
            <span className="text-sm">Business address</span>
            <input
              className="w-full border rounded px-3 py-2"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, Town, Postcode"
            />
          </label>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm">Phone</span>
              <input
                className="w-full border rounded px-3 py-2"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+44…"
              />
            </label>
            <label className="block">
              <span className="text-sm">Website</span>
              <input
                className="w-full border rounded px-3 py-2"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://…"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm">Contact email</span>
            <input
              className="w-full border rounded px-3 py-2"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm">About</span>
            <textarea
              className="w-full border rounded px-3 py-2"
              rows={4}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="Tell customers about your service…"
            />
          </label>

          {/* NEW: payment methods */}
          <PaymentMethodsSelector value={paymentMethods} onChange={setPaymentMethods} />

          {/* NEW: service types */}
          <ServiceTypesSelector value={serviceTypes} onChange={setServiceTypes} />

          <label className="block">
            <span className="text-sm">Logo (auto-resized to 300×300 PNG)</span>
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const f = e.target.files?.[0] || null;
                setLogoFile(f);
                setMsg(null);
                setErr(null);
                try {
                  if (f) {
                    const blob = await resizeTo300PNG(f);
                    setResizedLogo(blob);
                    setLogoPreview(URL.createObjectURL(blob));
                  } else {
                    setResizedLogo(null);
                    setLogoPreview(cleaner?.logo_url ?? null);
                  }
                } catch (ex: any) {
                  setErr(ex?.message ?? "Failed to process image.");
                }
              }}
            />
            {logoPreview && (
              <img
                src={logoPreview}
                alt="Logo preview"
                width={80}
                height={80}
                className="mt-2 h-20 w-20 object-contain rounded bg-white"
              />
            )}
            <p className="text-xs text-gray-500 mt-1">
              Preview shows the resized 300×300 image.
            </p>
          </label>

          {msg && <div className="text-green-700 text-sm">{msg}</div>}
          {err && <div className="text-red-700 text-sm">{err}</div>}

          <button
            className="bg-black text-white px-4 py-2 rounded disabled:opacity-60"
            disabled={!canSave || saving}
            onClick={save}
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </section>

        {/* RIGHT: Live preview */}
        <section className="p-4 border rounded-2xl bg-white">
          <h2 className="text-lg font-semibold mb-3">Business details (preview)</h2>
          <div className="flex items-start gap-4">
            {logoPreview ? (
              <img
                src={logoPreview}
                alt="Business logo"
                className="h-16 w-16 rounded bg-white object-contain border"
              />
            ) : (
              <div className="h-16 w-16 rounded bg-gray-200 border flex items-center justify-center text-xs text-gray-500">
                Logo
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xl font-bold truncate">
                {businessName || "Business name"}
              </div>
              <div className="text-gray-700 whitespace-pre-line">
                {address || "Business address"}
              </div>
              <div className="mt-2 space-y-1 text-sm">
                <div>
                  <span className="font-medium">Phone: </span>
                  {phone || "—"}
                </div>
                <div>
                  <span className="font-medium">Website: </span>
                  {website || "—"}
                </div>
                <div>
                  <span className="font-medium">Email: </span>
                  {contactEmail || "—"}
                </div>
              </div>

              {/* NEW: show payment methods */}
              {paymentMethods.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-medium text-gray-600 mb-1">Accepts:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {PAYMENT_METHODS.filter((m) => paymentMethods.includes(m.key)).map((m) => (
                      <span
                        key={m.key}
                        className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs"
                      >
                        <span className="leading-none">{m.icon}</span>
                        <span>{m.label}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* NEW: show service types */}
              {serviceTypes.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-medium text-gray-600 mb-1">Services:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {SERVICE_TYPES.filter((s) => serviceTypes.includes(s.key)).map((s) => (
                      <span
                        key={s.key}
                        className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs"
                      >
                        <span className="leading-none">{s.icon}</span>
                        <span>{s.label}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-4">
            This is a live preview of what customers will see on your public profile and quotes.
          </p>
        </section>
      </div>
    </main>
  );
}
