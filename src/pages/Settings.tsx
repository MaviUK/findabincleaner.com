// src/pages/Settings.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import CleanerCard from "../components/CleanerCard";
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

  // ✅ NEW: Google Place ID (optional)
  google_place_id?: string | null;
};


// ✅ Categories we want visible in the business UI (hide domestic-cleaner for now)
type Category = { id: string; name: string; slug: string };
const ALLOWED_CATEGORY_SLUGS = [
  "bin-cleaner",
  "window-cleaner",
  "domestic-cleaner",
] as const;

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
      "domestic-cleaner": 3, // keep it near "cleaner"
    };
    return [...categories].sort(
      (a, b) => (order[a.slug] ?? 99) - (order[b.slug] ?? 99)
    );
  }, [categories]);

  // ✅ UPDATED: Use your image icons instead of emoji
  const iconSrcFor = (slug: string) => {
    if (slug === "bin-cleaner") return "/icons/bin-cleaner.png";
    if (slug === "window-cleaner") return "/icons/window-cleaner.png";
    if (slug === "cleaner" || slug === "domestic-cleaner")
      return "/icons/general-cleaner.png";
    return null;
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">
        Industries (what you appear under)
      </div>
      <div className="flex flex-wrap gap-2">
        {ordered.map((c) => {
          const checked = selected.has(c.id);
          const iconSrc = iconSrcFor(c.slug);

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
              {iconSrc ? (
                <img
                  src={iconSrc}
                  alt=""
                  className="h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
              ) : null}
              <span>{c.name}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-gray-500">
        These control search + dashboard tabs + area purchases. (You can add more
        later.)
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

  // ✅ NEW: Google Place ID
  const [googlePlaceId, setGooglePlaceId] = useState("");

  // ✅ industries/categories state
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(
    new Set()
  );
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);

  // logo state
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [resizedLogo, setResizedLogo] = useState<Blob | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const navigate = useNavigate();

  // ✅ Address gating (trim whitespace)
  const addressTrimmed = useMemo(() => (address ?? "").trim(), [address]);

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

              // ✅ NEW
              google_place_id: null,
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
          .order("name", { ascending: true });

        if (catsErr) throw catsErr;

        if (!mounted) return;

        // filter to allowed slugs (keeps UI tidy)
        const allowed = new Set<string>(ALLOWED_CATEGORY_SLUGS as any);
        setCategories(
          ((cats ?? []) as Category[]).filter((c) => allowed.has(c.slug))
        );
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

        const next = new Set<string>(
          (picks ?? []).map((p: any) => String(p.category_id))
        );
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
    setPaymentMethods(
      Array.isArray(c.payment_methods) ? (c.payment_methods as string[]) : []
    );
  

    // ✅ NEW
    setGooglePlaceId((c as any).google_place_id ?? "");
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
    // ✅ Hard-block here too (prevents creating rows with empty address)
    const addr = (address ?? "").trim();
    if (!addr) throw new Error("Business address is required.");

    if (cleaner && cleaner.id) return cleaner.id;

    const { data: created, error } = await supabase
      .from("cleaners")
      .insert({
        user_id: userId,
        business_name: businessName || null,
        address: addr, // ✅ always trimmed & required
        phone: phone || null,
        whatsapp: whatsapp || null,
        website: website || null,
        about: about || null,
        contact_email: contactEmail || null,
        payment_methods: paymentMethods,
        

        // ✅ NEW
        google_place_id: googlePlaceId.trim() || null,
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
      // ✅ Hard block (prevents bypass via devtools)
      const addr = (address ?? "").trim();
      if (!addr) {
        setErr("Business address is required.");
        return;
      }

      const id = await ensureRow();
      const newLogo = await uploadLogoIfAny();

      const payload: Partial<Cleaner> & {
        payment_methods?: string[];
        
      } = {
        business_name: businessName || null,
        address: addr, // ✅ always trimmed & required
        phone: phone || null,
        whatsapp: whatsapp || null,
        website: website || null,
        about: about || null,
        contact_email: contactEmail || null,
        logo_url: newLogo ?? logoPreview ?? null,
        payment_methods: paymentMethods,
       

        // ✅ NEW
        google_place_id: googlePlaceId.trim() || null,
      };

      const { error } = await supabase.from("cleaners").update(payload).eq("id", id);
      if (error) throw error;

      // ✅ save category selections too
      await saveCategories(id);

      // ✅ NEW: sync Google rating if Place ID exists
      if (googlePlaceId.trim()) {
        try {
          await fetch("/.netlify/functions/syncGoogleRating", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cleaner_id: id }),
          });
        } catch (e) {
          console.warn("Google rating sync failed", e);
          // Do NOT block saving if Google fails
        }
      }

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

  const hasAnyContactMethod = useMemo(() => {
    return (
      phone.trim().length > 0 ||
      website.trim().length > 0 ||
      whatsapp.trim().length > 0
    );
  }, [phone, website, whatsapp]);

  // ✅ UPDATED: require address too
  const canSave = useMemo(
    () =>
      businessName.trim().length > 0 &&
      addressTrimmed.length > 0 &&
      hasAnyContactMethod,
    [businessName, addressTrimmed, hasAnyContactMethod]
  );

  // Build the preview object for the CleanerCard
const previewCleaner: any = useMemo(
  () => ({
    cleaner_id: "preview", // keep as preview
    business_name: businessName || "Business name",
    logo_url: logoPreview || undefined,
    website: website || null,
    phone: phone || null,
    whatsapp: whatsapp || null,
    payment_methods: toArr(paymentMethods),
  

    // ✅ ADD THESE (match CleanerCard)
    google_rating: (cleaner as any)?.google_rating ?? null,
    google_reviews_count: (cleaner as any)?.google_reviews_count ?? null,

    // ✅ ALSO add legacy support just in case your DB uses these names
    rating_avg: (cleaner as any)?.rating_avg ?? null,
    rating_count: (cleaner as any)?.rating_count ?? null,
  }),
  [
    cleaner,
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
      {!hasAnyContactMethod && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <div className="font-semibold mb-1">
            Action required: add contact details
          </div>
          <p className="text-sm">
            Your business <strong>will not appear in search results</strong>{" "}
            until at least one contact method is added.
          </p>
          <p className="text-sm mt-1">
            Please add at least one of: <strong>Phone</strong>,{" "}
            <strong>Website</strong>, or <strong>WhatsApp</strong>.
          </p>
        </div>
      )}

      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
      </header>

      {/* TOP: Full-width preview */}
      <section className="p-0 bg-transparent border-0">
        <h2 className="text-lg font-semibold mb-3">
          Business details (preview)
        </h2>

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
            {!addressTrimmed && (
              <p className="mt-1 text-sm text-red-700">
                Business address is required.
              </p>
            )}
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

          {/* ✅ industries/categories selection */}
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

          {/* ✅ Google Place ID */}
          <div className="pt-2 border-t">
            <div className="text-sm font-medium">
              Google Business Profile (optional)
            </div>

            <label className="block mt-2">
              <span className="text-sm">Google Place ID</span>
              <input
                className="w-full border rounded px-3 py-2"
                value={googlePlaceId}
                onChange={(e) => {
                  setMsg(null);
                  setErr(null);
                  setGooglePlaceId(e.target.value);
                }}
                placeholder="e.g. ChIJN1t_tDeuEmsRUsoyG83frY4"
              />
              <span className="text-xs text-gray-500">
                Add your Place ID to show your Google rating under your name in listings.
              </span>
            </label>

            <a
              className="text-xs text-blue-600 underline mt-1 inline-block"
              href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder"
              target="_blank"
              rel="noreferrer"
            >
              Find my Place ID
            </a>
          </div>

          {/* Logo */}
          <div>
            <div className="text-sm font-medium">
              Logo (auto-resized to 300×300 PNG)
            </div>
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
            <p className="text-xs text-gray-500 mt-1">
              Preview shows the resized 300×300 image.
            </p>
          </div>

          {msg && <div className="text-green-700 text-sm">{msg}</div>}
          {err && <div className="text-red-700 text-sm">{err}</div>}

          <button
            className="bg-black text-white px-4 py-2 rounded disabled:opacity-60"
            disabled={!canSave || saving}
            onClick={save}
            title={
              !addressTrimmed
                ? "Add a business address to save."
                : !hasAnyContactMethod
                ? "Add at least one contact method (Phone, Website, or WhatsApp) to appear in results."
                : undefined
            }
          >
            {!addressTrimmed
              ? "Add business address to continue"
              : !hasAnyContactMethod
              ? "Add contact details to continue"
              : saving
              ? "Saving…"
              : "Save settings"}
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
