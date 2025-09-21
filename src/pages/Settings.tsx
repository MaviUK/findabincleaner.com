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
};

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

    // optional white background (uncomment if you don't want transparency)
    // ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);

    // cover the 300x300 square while preserving aspect ratio
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

  // logo state
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // Load session + profile
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          // hash-router friendly redirect
          window.location.hash = "#/login";
          return;
        }
        setUserId(user.id);

        const { data, error } = await supabase
          .from("cleaners")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          // create a basic record if it doesn't exist (keeps Settings robust)
          const { data: created, error: insertErr } = await supabase
            .from("cleaners")
            .insert({
              user_id: user.id,
              business_name: user.email?.split("@")[0] ?? null,
            })
            .select("*")
            .single();
          if (insertErr) throw insertErr;
          fillForm(created as Cleaner, user.email ?? "");
        } else {
          fillForm(data as Cleaner, user.email ?? "");
        }
      } catch (e: any) {
        setErr(e.message || "Failed to load profile.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }

  // Upload (resized) logo to Storage and return public URL
  async function uploadLogoIfAny(): Promise<string | null> {
    if (!logoFile || !userId) return logoPreview || null;

    const png = await resizeTo300PNG(logoFile);
    const path = `${userId}/logo.png`;

    const { error: upErr } = await supabase.storage
      .from("logos")
      .upload(path, png, { upsert: true, cacheControl: "3600", contentType: "image/png" });

    if (upErr) throw upErr;

    const { data } = supabase.storage.from("logos").getPublicUrl(path);
    return data.publicUrl;
  }

  async function save() {
    if (!cleaner) return;
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const newLogo = await uploadLogoIfAny();
      const payload: Partial<Cleaner> = {
        business_name: businessName || null,
        address: address || null,
        phone: phone || null,
        website: website || null,
        about: about || null,
        contact_email: contactEmail || null,
        logo_url: newLogo ?? logoPreview ?? null,
      };

      const { error } = await supabase
        .from("cleaners")
        .update(payload)
        .eq("id", cleaner.id);

      if (error) throw error;

      // update local state
      setCleaner((prev) => (prev ? { ...prev, ...payload } as Cleaner : prev));
      if (newLogo) setLogoPreview(newLogo);
      setMsg("Settings saved.");
    } catch (e: any) {
      setErr(e.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const canSave = useMemo(() => {
    return businessName.trim().length > 0;
  }, [businessName]);

  if (loading) return <div className="p-6">Loading…</div>;
  if (!cleaner) return <div className="p-6">Could not find profile.</div>;

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 text-sm">
        <a className="underline" href="#/">Find a Bin Cleaner</a>
        <a className="underline" href="#/dashboard">Dashboard</a>
        <a className="underline" href="#/settings">Profile</a>
        <button
          className="ml-auto bg-black text-white px-3 py-1 rounded"
          onClick={async () => {
            await supabase.auth.signOut();
            window.location.hash = "#/";
          }}
        >
          Logout
        </button>
      </div>

      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-3 p-4 border rounded-xl">
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

          <label className="block">
            <span className="text-sm">Logo (auto-resized to 300×300 PNG)</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setLogoFile(f);
                if (f) setLogoPreview(URL.createObjectURL(f));
              }}
            />
            {logoPreview && (
              <img
                src={logoPreview}
                alt="Logo preview"
                className="mt-2 h-20 w-20 object-contain rounded bg-white"
              />
            )}
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
        </div>

        <div className="p-4 border rounded-xl text-sm text-gray-600">
          <p className="mb-2">
            <strong>Tips</strong>
          </p>
          <ul className="list-disc ml-5 space-y-1">
            <li>Your logo is stored and served as a 300×300 PNG for consistent display.</li>
            <li>Keep your address accurate so search results and quotes show the right area.</li>
            <li>Website and phone are optional but help customers contact you faster.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
