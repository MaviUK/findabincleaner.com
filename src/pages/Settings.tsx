// src/pages/Settings.tsx
import { useEffect, useState } from "react";
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
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = URL.createObjectURL(file);
  });
  const target = 300;
  const canvas = document.createElement("canvas");
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext("2d")!;
  // transparent bg; if you want white, uncomment:
  // ctx.fillStyle = "#fff"; ctx.fillRect(0,0,target,target);
  const scale = Math.min(target / img.width, target / img.height);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const dx = Math.floor((target - w) / 2);
  const dy = Math.floor((target - h) / 2);
  ctx.drawImage(img, dx, dy, w, h);
  return await new Promise<Blob>((res) => canvas.toBlob(b => res(b!), "image/png", 0.92));
}

export default function Settings() {
  const [userId, setUserId] = useState<string | null>(null);
  const [cleaner, setCleaner] = useState<Cleaner | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [about, setAbout] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { window.location.href = "/login"; return; }
        setUserId(user.id);
        const { data, error } = await supabase.from("cleaners").select("*").eq("user_id", user.id).maybeSingle();
        if (error) throw error;
        if (data) {
          const c = data as Cleaner;
          setCleaner(c);
          setName(c.business_name || "");
          setAddress(c.address || "");
          setPhone(c.phone || "");
          setWebsite(c.website || "");
          setAbout(c.about || "");
          setContactEmail(c.contact_email || user.email || "");
          setLogoPreview(c.logo_url || null);
        }
      } catch (e: any) {
        setErr(e.message || "Failed to load settings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function uploadLogo(): Promise<string | null> {
    if (!logoFile || !userId) return logoPreview || null;
    const resized = await resizeTo300PNG(logoFile);
    const path = `${userId}/logo.png`;
    const { error } = await supabase.storage.from("logos").upload(path, resized, {
      upsert: true, cacheControl: "3600", contentType: "image/png",
    });
    if (error) throw error;
    const { data } = supabase.storage.from("logos").getPublicUrl(path);
    return data.publicUrl;
  }

  async function save() {
    if (!cleaner) return;
    setSaving(true); setMsg(null); setErr(null);
    try {
      const newLogo = await uploadLogo();
      const { error } = await supabase.from("cleaners").update({
        business_name: name || null,
        address: address || null,
        phone: phone || null,
        website: website || null,
        about: about || null,
        contact_email: contactEmail || null,
        logo_url: newLogo ?? logoPreview ?? null,
      }).eq("id", cleaner.id);
      if (error) throw error;
      if (newLogo) setLogoPreview(newLogo);
      setMsg("Settings saved.");
    } catch (e: any) {
      setErr(e.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;
  if (err) return <div className="p-6 text-red-600">Error: {err}</div>;
  if (!cleaner) return <div className="p-6">No cleaner profile found.</div>;

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold">Profile / Settings</h1>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-3 p-4 border rounded-xl">
          <label className="block">
            <span className="text-sm">Business name</span>
            <input className="w-full border rounded px-3 py-2" value={name} onChange={e => setName(e.target.value)} />
          </label>

          <label className="block">
            <span className="text-sm">Address</span>
            <input className="w-full border rounded px-3 py-2" value={address} onChange={e => setAddress(e.target.value)} placeholder="Street, Town, Postcode" />
          </label>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm">Phone</span>
              <input className="w-full border rounded px-3 py-2" value={phone} onChange={e => setPhone(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-sm">Website</span>
              <input className="w-full border rounded px-3 py-2" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://…" />
            </label>
          </div>

          <label className="block">
            <span className="text-sm">Contact email</span>
            <input className="w-full border rounded px-3 py-2" value={contactEmail} onChange={e => setContactEmail(e.target.value)} />
          </label>

          <label className="block">
            <span className="text-sm">About</span>
            <textarea className="w-full border rounded px-3 py-2" rows={4} value={about} onChange={e => setAbout(e.target.value)} />
          </label>

          <label className="block">
            <span className="text-sm">Logo (auto-resized to 300×300)</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setLogoFile(f);
                if (f) setLogoPreview(URL.createObjectURL(f));
              }}
            />
            {logoPreview && <img src={logoPreview} alt="logo" className="h-20 w-20 object-contain mt-2 rounded" />}
          </label>

          {msg && <div className="text-green-700 text-sm">{msg}</div>}
          {err && <div className="text-red-700 text-sm">{err}</div>}

          <button className="bg-black text-white px-4 py-2 rounded disabled:opacity-60" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>

        <div className="p-4 border rounded-xl text-sm text-gray-600">
          <b>Tip:</b> Your logo is stored at 300×300 and shown on your public profile and quotes.
          Keep the name and address accurate so customers can find you.
        </div>
      </div>
    </div>
  );
}
