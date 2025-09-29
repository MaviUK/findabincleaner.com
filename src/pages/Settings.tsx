// src/pages/Settings.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import CleanerCard from "../components/CleanerCard";
import LogoutButton from "../components/LogoutButton";
import { PAYMENT_METHODS as PM_ALL } from "../constants/paymentMethods";
import AccountDangerZone from "../components/settings/AccountDangerZone";

type Cleaner = {
  id: string;
  user_id: string;
  business_name: string | null;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  about: string | null;
  contact_email: string | null;
  payment_methods?: string[] | null;
  service_types?: string[] | null;
};

const SERVICE_TYPES: { key: string; label: string; icon?: string }[] = [
  { key: "domestic", label: "Domestic", icon: "🏠" },
  { key: "commercial", label: "Commercial", icon: "🏢" },
];

// what CleanerCard needs
type CleanerCardShape = {
  id: string;
  business_name: string;
  logo_url?: string | null;
  website?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  distance_m?: number | null;
  payment_methods?: string[];
  service_types?: string[];
};

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

/* ---------- little UI helpers (pills) ---------- */
function PaymentPills({
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
        {PM_ALL.map((m) => {
          const checked = value.includes(m.key);
          return (
            <label
              key={m.key}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm cursor-pointer select-none transition ${
                checked
                  ? "bg-black text-white border-black"
                  : "bg-white hover:bg-gray-50 border-gray-300"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={(e) => toggle(m.key, e.target.checked)}
              />
              <img src={m.iconUrl} alt="" className="h-4 w-4" />
              <span>{m.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function ServiceTypePills({
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
        {SERVICE_TYPES.map((m) => {
          const checked = value.includes(m.key);
          return (
            <label
              key={m.key}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm cursor-pointer select-none transition ${
                checked
                  ? "bg-black text-white border-black"
                  : "bg-white hover:bg-gray-50 border-gray-300"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={(e) => toggle(m.key, e.target.checked)}
              />
              {m.icon && <span className="text-base leading-none">{m.icon}</span>}
              <span>{m.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- page ---------- */
export default function Settings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const firstRun = searchParams.get("firstRun") === "1";

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
  const [whatsapp, setWhatsapp] = useState("");
  const [website, setWebsite] = useState("");
  const [about, setAbout] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [serviceTypes, setServiceTypes] = useState<string[]>([]);

  // logo state
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [resizedLogo, setResizedLogo] = useState<Blob | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data: { session }, error: sErr } = await supabase.auth.getSession();
        if (sErr) throw sErr;

        if (!session?.user) {
          navigate("/login", { replace: true });
          return;
        }

        setUserId(session.user.id);

        // Try get existing cleaner row
        const { data, error } = await supabase
          .from("cleaners")
          .select("*")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (error) throw error;

        if (mounted) {
          if (data) {
            setCleaner(data as Cleaner);
            fillForm(data as Cleaner, session.user.email ?? "");
          } else {
            // No row yet — show empty form (first-run)
            setCleaner(null);
            fillForm(
              {
                id: "",
                user_id: session.user.id,
                business_name: null,
                logo_url: null,
                address: null,
                phone: null,
                whatsapp: null,
                website: null,
                about: null,
                contact_email: session.user.email ?? null,
                payment_methods: [] as string[],
                service_types: [] as string[],
              },
              session.user.email ?? ""
            );
          }
        }
      } catch (e: any) {
        if (mounted) setErr(e.message || "Failed to load profile.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!session) navigate("/login", { replace: true });
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  function fillForm(c: Cleaner, fallbackEmail: string) {
    setBusinessName(c.business_name ?? "");
    setAddress(c.address ?? "");
    setPhone(c.phone ?? "");
    setWhatsapp(c.whatsapp ?? "");
    setWebsite(c.website ?? "");
    setAbout(c.about ?? "");
    setContactEmail(c.contact_email ?? fallbackEmail ?? "");
    setLogoPreview(c.logo_url ?? null);
    setPaymentMethods(Array.isArray(c.payment_methods) ? (c.payment_methods as string[]) : []);
    setServiceTypes(Array.isArray(c.service_types) ? (c.service_types as string[]) : []);
  }

  // IMPORTANT: never insert without a business name (avoids NOT NULL violation)
  async function ensureRow(): Promise<string> {
    if (cleaner && cleaner.id) return cleaner.id;

    const name = businessName.trim();
    if (!name) {
      throw new Error("Please enter your business name before saving.");
    }

    const { data: created, error } = await supabase
      .from("cleaners")
      .insert({
        user_id: userId,
        business_name: name, // non-null
        address: address || null,
        phone: phone || null,
        whatsapp: whatsapp || null,
        website: website || null,
        about: about || null,
        contact_email: contactEmail || null,
        payment_methods: paymentMethods,
        service_types: serviceTypes,
      })
      .select("id,*")
      .single();

    if (error) throw error;
    setCleaner(created as Cleaner);
    return created.id as string;
  }

  async function uploadLogoIfAny(): Promise<string | null> {
    try {
      if (!logoFile || !userId) return logoPreview || null;
      const png = resizedLogo ?? (await resizeTo300PNG(logoFile));
      const path = `${userId}/logo.png`;
      const { error: upErr } = await supabase.storage
        .from("logos")
        .upload(path, png, { upsert: true, cacheControl: "3600", contentType: "image/png" });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("logos").getPublicUrl(path);
      return data.publicUrl;
    } catch (e) {
      // Non-blocking; still save the rest
      console.warn("Logo upload failed:", e);
      return logoPreview || null;
    }
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const {
        data: { session },
        error: sErr,
      } = await supabase.auth.getSession();
      if (sErr) throw sErr;
      if (!session?.user) throw new Error("You are not signed in.");

      const id = await ensureRow();
      const newLogo = await uploadLogoIfAny();

      const payload: Partial<Cleaner> & {
        payment_methods?: string[];
        service_types?: string[];
      } = {
        business_name: businessName.trim(),
        address: address || null,
        phone: phone || null,
        whatsapp: whatsapp || null,
        website: website || null,
        about: about || null,
        contact_email: contactEmail || null,
        logo_url: newLogo ?? logoPreview ?? null,
        payment_methods: paymentMethods,
        service_types: serviceTypes,
      };

      const { error } = await supabase.from("cleaners").update(payload).eq("id", id);
      if (error) throw error;

      setCleaner((prev) => (prev ? ({ ...prev, ...payload, id } as Cleaner) : prev));
      if (newLogo) setLogoPreview(newLogo);
      setLogoFile(null);
      setResizedLogo(null);
      setMsg(firstRun ? "Setup complete." : "Settings saved.");

      if (firstRun) {
        // First-time setup finished — take them to dashboard
        navigate("/dashboard", { replace: true });
      }
    } catch (e: any) {
      setErr(e.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const canSave = useMemo(() => businessName.trim().length > 0, [businessName]);

  // Build the preview object for the CleanerCard
  const previewCleaner: CleanerCardShape = useMemo(
    () => ({
      id: cleaner?.id || "preview",
      business_name: businessName || "Business name",
      logo_url: logoPreview || undefined,
      website: website || null,
      phone: phone || null,
      whatsapp: whatsapp || null,
      rating_avg: null,
      rating_count: null,
      distance_m: null,
      payment_methods: paymentMethods,
      service_types: serviceTypes,
    }),
    [cleaner?.id, businessName, logoPreview, website, phone, whatsapp, paymentMethods, serviceTypes]
  );

  if (loading) {
    return <main className="container mx-auto max-w-6xl px-4 py-8">Loading…</main>;
  }

  return (
    <main className="container mx-auto max-w-6xl px-4 py-8 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <LogoutButton />
      </header>

      {firstRun && !cleaner?.id && (
        <div className="rounded-xl border p-4 bg-amber-50 text-amber-900 text-sm">
          Welcome! Enter your business details to finish setup.
        </div>
      )}

      {/* TOP: Full-width preview using the actual search card */}
      <section className="p-0 bg-transparent border-0">
        <h2 className="text-lg font-semibold mb-3">Business details (preview)</h2>

        <div className="rounded-xl border border-black/5 bg-white p-4">
          <CleanerCard cleaner={previewCleaner as any} showPayments />
        </div>

        <p className="text-xs text-gray-500 mt-3">
          This matches how your listing appears in search results.
        </p>
      </section>

      {/* BELOW: Two-column form */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* LEFT: Core details */}
        <section className="space-y-3 p-4 border rounded-2xl bg-white">
          <label className="block">
            <span className="text-sm">Business name *</span>
            <input
              className="w-full border rounded px-3 py-2"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. NI Bin Guy"
              required
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
            <span className="text-sm">WhatsApp (optional)</span>
            <input
              className="w-full border rounded px-3 py-2"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+447… or full wa.me link"
            />
            <span className="text-xs text-gray-500">
              Enter an international number (e.g. +447…) or a full WhatsApp link.
            </span>
          </label>

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
        </section>

        {/* RIGHT: Methods, services, logo, save */}
        <section className="space-y-4 p-4 border rounded-2xl bg-white">
          <PaymentPills value={paymentMethods} onChange={setPaymentMethods} />
          <ServiceTypePills value={serviceTypes} onChange={setServiceTypes} />

          <div>
            <div className="text-sm font-medium">Logo (auto-resized to 300×300 PNG)</div>
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
              className="mt-1"
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
            <p className="text-xs text-gray-500 mt-1">Preview shows the resized 300×300 image.</p>
          </div>

          {msg && <div className="text-green-700 text-sm">{msg}</div>}
          {err && <div className="text-red-700 text-sm">{err}</div>}

          <button
            className="bg-black text-white px-4 py-2 rounded disabled:opacity-60"
            disabled={!canSave || saving}
            onClick={save}
          >
            {saving ? "Saving…" : cleaner?.id ? "Save settings" : "Create profile"}
          </button>
        </section>
      </div>

      {/* Danger Zone */}
      <section className="space-y-3 p-4 border rounded-2xl bg-white">
        <h2 className="text-lg font-semibold">Account</h2>
        <AccountDangerZone businessName={businessName || null} />
      </section>
    </main>
  );
}
