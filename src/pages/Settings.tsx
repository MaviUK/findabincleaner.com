// src/pages/Settings.tsx
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  useLoadScript,
  StandaloneSearchBox,
} from "@react-google-maps/api";

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

export default function Settings() {
  const [cleaner, setCleaner] = useState<Cleaner | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [about, setAbout] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { isLoaded } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY as string,
    libraries: ["places"],
  });
  const sbRef = useRef<google.maps.places.SearchBox | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }
      setUserId(user.id);

      const { data } = await supabase.from("cleaners").select("*").eq("user_id", user.id).maybeSingle();
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
    })();
  }, []);

  const onSBLoad = (ref: google.maps.places.SearchBox) => (sbRef.current = ref);
  const onPlacesChanged = () => {
    const sb = sbRef.current;
    const place = sb?.getPlaces()?.[0];
    if (place) setAddress(place.formatted_address || inputRef.current?.value || "");
  };

  async function uploadLogo(): Promise<string | null> {
    if (!logoFile || !userId) return logoPreview || null;
    const ext = (logoFile.name.split(".").pop() || "png").toLowerCase();
    const path = `${userId}/logo.${ext}`;
    const { error } = await supabase.storage.from("logos").upload(path, logoFile, {
      upsert: true,
      cacheControl: "3600",
      contentType: logoFile.type || `image/${ext}`,
    });
    if (error) throw error;
    const { data } = supabase.storage.from("logos").getPublicUrl(path);
    return data.publicUrl;
  }

  async function save() {
    if (!cleaner) return;
    setSaving(true); setError(null); setMsg(null);
    try {
      const newLogoUrl = await uploadLogo();

      const { error } = await supabase.from("cleaners")
        .update({
          business_name: name || null,
          address: address || null,
          phone: phone || null,
          website: website || null,
          about: about || null,
          contact_email: contactEmail || null,
          logo_url: newLogoUrl || logoPreview || null,
        })
        .eq("id", cleaner.id);

      if (error) throw error;

      setLogoPreview(newLogoUrl || logoPreview || null);
      setMsg("Settings saved.");
    } catch (e: any) {
      setError(e.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  if (!cleaner) return <div className="p-6">Loading…</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Cleaner Settings</h1>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-3 p-4 border rounded-xl">
          <label className="block">
            <span className="text-sm">Business name</span>
            <input className="w-full border rounded px-3 py-2" value={name} onChange={e=>setName(e.target.value)} />
          </label>

          <label className="block">
            <span className="text-sm">Business address</span>
            {isLoaded ? (
              <StandaloneSearchBox onLoad={onSBLoad} onPlacesChanged={onPlacesChanged}>
                <input
                  ref={inputRef}
                  className="w-full border rounded px-3 py-2"
                  placeholder="Start typing your address…"
                  defaultValue={address}
                  onChange={(e)=>setAddress(e.target.value)}
                />
              </StandaloneSearchBox>
            ) : (
              <input className="w-full border rounded px-3 py-2" value={address} onChange={(e)=>setAddress(e.target.value)} />
            )}
          </label>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm">Phone</span>
              <input className="w-full border rounded px-3 py-2" value={phone} onChange={e=>setPhone(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-sm">Website</span>
              <input className="w-full border rounded px-3 py-2" value={website} onChange={e=>setWebsite(e.target.value)} placeholder="https://…" />
            </label>
          </div>

          <label className="block">
            <span className="text-sm">Contact email</span>
            <input className="w-full border rounded px-3 py-2" value={contactEmail} onChange={e=>setContactEmail(e.target.value)} />
          </label>

          <label className="block">
            <span className="text-sm">About</span>
            <textarea className="w-full border rounded px-3 py-2" rows={4} value={about} onChange={e=>setAbout(e.target.value)} />
          </label>

          <label className="block">
            <span className="text-sm">Logo</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setLogoFile(f);
                if (f) setLogoPreview(URL.createObjectURL(f));
              }}
            />
            {logoPreview && <img src={logoPreview} alt="logo" className="h-14 mt-2" />}
          </label>

          {error && <div className="text-red-600 text-sm">{error}</div>}
          {msg && <div className="text-green-700 text-sm">{msg}</div>}

          <button className="bg-black text-white px-4 py-2 rounded disabled:opacity-60" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>

        <div className="p-4 border rounded-xl text-sm text-gray-700">
          <b>Tip:</b> These details appear on your public profile and quotes you send to customers.
        </div>
      </div>
    </div>
  );
}
