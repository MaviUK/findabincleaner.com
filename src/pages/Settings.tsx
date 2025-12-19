// src/pages/Settings.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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

// ✅ Categories we want visible in the business UI (hide domestic-cleaner for now)
type Category = { id: string; name: string; slug: string };
const ALLOWED_CATEGORY_SLUGS = ["bin-cleaner", "window-cleaner", "cleaner"] as const;

// shape the CleanerCard expects (lightweight local type)
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

// ✅ Category pills for industries (bin-cleaner / window-cleaner / cleaner)
function CategoryPills({
  categories,
  selected,
  onToggle,
}: {
  categories: Category[];
  selected: Set<string>;
  onToggle: (categoryId: string) => void;
}) {
  const ordered = useMemo(() => {
    const order: Record<string, number> = {
      "bin-cleaner": 1,
      "window-cleaner": 2,
      cleaner: 3,
    };
    return [...categories].sort(
      (a, b) => (order[a.slug] ?? 99) - (order[b.slug] ?? 99)
    );
  }, [categories]);

  const iconFor = (slug: string) => {
    if (slug === "bin-cleaner") return "🗑️";
    if (slug === "window-cleaner") return "🪟";
    return "🧼";
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Industries (what you appear under)</div>
      <div className="flex flex-wrap gap-2">
        {ordered.map((c) => {
          const checked = selected.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onToggle(c.id)}
              className={[
                "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-semibold select-none transition",
                checked
                  ? "bg-emerald-700 text-white border-emerald-700"
                  : "bg-white hover:bg-gray-50 border-gray-300",
              ].join(" ")}
            >
              <span className="text-base leading-none">{iconFor(c.slug)}</span>
              <span>{c.name}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-gray-500">
        These control search + dashboard tabs + area purchases. (You can add more later.)
      </p>
    </div>
  );
}

// coerce unknown/CSV/JSON values to a string[]
const toArr = (v: any): string[] => {
  if (!v) return [];
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
};

/* ---------- page ---------- */
export default function Settings() {
  const [userId, setUserId] = useState<string | null>(null);
  const [cleaner, setCleaner] = useState<Cleaner | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
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

  // ✅ industries/categories state
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set());
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);

  // logo state
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [resizedLogo, setResizedLogo] = useState<Blob | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!mounted) return;

        if (!session?.user) {
          navigate("/login", { replace: true });
          return;
        }

        setUserId(session.user.id);

        const { data, error } = await supabase
          .from("cleaners")
          .select("*")
          .eq("user_id", session.user.id)
          .maybeSingle();
        if (error) throw error;

        if (!data) {
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
        } else {
          fillForm(data as Cleaner, session.user.email ?? "");
        }

        // ✅ Load categories list (always)
        const { data: cats, error: catsErr } = await supabase
          .from("service_categories")
          .select("id,name,slug")
          .in("slug", [...ALLOWED_CATEGORY_SLUGS]);

        if (catsErr) throw catsErr;

        if (!mounted) return;
        setCategories((cats ?? []) as Category[]);
      } catch (e: any) {
        setErr(e.message || "Failed to load profile.");
      } finally {
        if (mounted) {
          setLoading(false);
          setReady(true);
        }
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

  // ✅ Once we have a cleaner id, load the current selected categories
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        if (!ready) return;
        if (!cleaner?.id) {
          // if no cleaner row yet, selections will save on first Save
          setSelectedCategoryIds(new Set());
          setCategoriesLoaded(true);
          return;
        }

        const { data: picks, error } = await supabase
          .from("cleaner_category_offerings")
          .select("category_id")
          .eq("cleaner_id", cleaner.id)
          .eq("is_active", true);

        if (error) throw error;

        const next = new Set<string>((picks ?? []).map((p: any) => String(p.category_id)));
        if (!mounted) return;
        setSelectedCategoryIds(next);
        setCategoriesLoaded(true);
      } catch (e: any) {
        console.error(e);
        if (mounted) {
          setCategoriesLoaded(true);
          // don't hard-fail the whole settings page if this fails
          setErr((prev) => prev ?? "Failed to load industry selections.");
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [ready, cleaner?.id]);

  function fillForm(c: Cleaner, fallbackEmail: string) {
    setCleaner(c);
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

  function toggleCategory(categoryId: string) {
    setMsg(null);
    setErr(null);

    setSelectedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  async function ensureRow(): Promise<string> {
    if (cleaner && cleaner.id) return cleaner.id;

    const { data: created, error } = await supabase
      .from("cleaners")
      .insert({
        user_id: userId,
        business_name: businessName || null,
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
    if (!logoFile || !userId) return logoPreview || null;
    const png = resizedLogo ?? (await resizeTo300PNG(logoFile));
    const path = `${userId}/logo.png`;
    const { error: upErr } = await supabase.storage
      .from("logos")
      .upload(path, png, {
        upsert: true,
        cacheControl: "3600",
        contentType: "image/png",
      });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from("logos").getPublicUrl(path);
    return data.publicUrl;
  }

  // ✅ Save category selections into cleaner_category_offerings
  async function saveCategories(cleanerId: string) {
    const selected = Array.from(selectedCategoryIds);
    const all = categories.map((c) => c.id);
    const unselected = all.filter((id) => !selectedCategoryIds.has(id));

    // Turn ON selected (upsert)
    if (selected.length) {
      const rows = selected.map((category_id) => ({
        cleaner_id: cleanerId,
        category_id,
        is_active: true,
      }));

      const { error: upsertErr } = await supabase
        .from("cleaner_category_offerings")
        .upsert(rows, { onConflict: "cleaner_id,category_id" });

      if (upsertErr) throw upsertErr;
    }

    // Turn OFF unselected
    if (unselected.length) {
      const { error: offErr } = await supabase
        .from("cleaner_category_offerings")
        .update({ is_active: false })
        .eq("cleaner_id", cleanerId)
        .in("category_id", unselected);

      if (offErr) throw offErr;
    }
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

      // ✅ save category selections too
      await saveCategories(id);

      setCleaner((prev) => (prev ? ({ ...prev, ...payload, id } as Cleaner) : prev));
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
      payment_methods: toArr(paymentMethods),
      service_types: toArr(serviceTypes),
    }),
    [
      cleaner?.id,
      businessName,
      logoPreview,
      website,
      phone,
      whatsapp,
      paymentMethods,
      serviceTypes,
    ]
  );

  if (loading || !ready) {
    return <main className="container mx-auto max-w-6xl px-4 py-8">Loading…</main>;
  }

  return (
    <main className="container mx-auto max-w-6xl px-4 py-8 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <LogoutButton />
      </header>

      {/* TOP: Full-width preview */}
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

        {/* RIGHT: Methods, industries, logo, save */}
        <section className="space-y-4 p-4 border rounded-2xl bg-white">
          <PaymentPills value={paymentMethods} onChange={setPaymentMethods} />

          {/* (Optional) keep if you still want domestic/commercial on listing */}
          <ServiceTypePills value={serviceTypes} onChange={setServiceTypes} />

          {/* ✅ NEW: industries/categories selection */}
          <div className="pt-2 border-t">
            {!categoriesLoaded ? (
              <div className="text-sm text-gray-500">Loading industries…</div>
            ) : (
              <CategoryPills
                categories={categories}
                selected={selectedCategoryIds}
                onToggle={toggleCategory}
              />
            )}
          </div>

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
            {saving ? "Saving…" : "Save settings"}
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
