// src/pages/Settings.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

// Tiny emoji icons for now (easy to swap to SVG later)
const PAYMENT_METHODS = [
  { key: "bank_transfer", label: "Bank Transfer", icon: "🏦" },
  { key: "cash",          label: "Cash",          icon: "💵" },
  { key: "stripe",        label: "Stripe",        icon: "🟦" },
  { key: "gocardless",    label: "GoCardless",    icon: "🔵" },
  { key: "paypal",        label: "PayPal",        icon: "🅿️" },
  { key: "card_machine",  label: "Card Machine",  icon: "💳" },
];

function PaymentMethodsSelector({ value = [], onChange }) {
  const setHas = (k, has) => {
    if (!onChange) return;
    const set = new Set(value);
    has ? set.add(k) : set.delete(k);
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
              className={`cursor-pointer select-none inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition
                ${checked ? "bg-black text-white border-black" : "bg-white hover:bg-gray-50 border-gray-300"}`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={(e) => setHas(m.key, e.target.checked)}
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

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState(null);

  // Form state
  const [businessName, setBusinessName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [about, setAbout] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoFile, setLogoFile] = useState(null);
  const [paymentMethods, setPaymentMethods] = useState([]); // <— NEW

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);

      // Load existing profile (adjust table/columns if yours differ)
      const { data, error } = await supabase
        .from("cleaners")
        .select("business_name,address,phone,website,contact_email,about,logo_url,payment_methods")
        .eq("user_id", user.id)
        .single();

      if (!error && data) {
        setBusinessName(data.business_name || "");
        setAddress(data.address || "");
        setPhone(data.phone || "");
        setWebsite(data.website || "");
        setEmail(data.contact_email || "");
        setAbout(data.about || "");
        setLogoUrl(data.logo_url || "");
        setPaymentMethods(Array.isArray(data.payment_methods) ? data.payment_methods : []);
      }
      setLoading(false);
    })();
  }, []);

  const uploadLogoIfNeeded = async () => {
    if (!logoFile || !userId) return logoUrl || "";
    const fileExt = logoFile.name.split(".").pop();
    const path = `logos/${userId}.${fileExt}`;
    const { error: upErr } = await supabase.storage.from("assets").upload(path, logoFile, { upsert: true });
    if (upErr) throw upErr;
    const { data: publicUrl } = supabase.storage.from("assets").getPublicUrl(path);
    return publicUrl?.publicUrl || "";
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const newLogoUrl = await uploadLogoIfNeeded();

      const payload = {
        business_name: businessName,
        address,
        phone,
        website,
        contact_email: email,
        about,
        logo_url: newLogoUrl,
        payment_methods: paymentMethods, // <— NEW
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("cleaners")
        .upsert({ user_id: userId, ...payload }, { onConflict: "user_id" });

      if (error) throw error;
    } catch (e) {
      alert(e.message || "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const previewLines = useMemo(() => {
    const lines = [];
    if (businessName) lines.push(businessName);
    if (address) lines.push(address);
    if (phone) lines.push(`Phone: ${phone}`);
    if (website) lines.push(`Website: ${website}`);
    if (email) lines.push(`Email: ${email}`);
    return lines;
  }, [businessName, address, phone, website, email]);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold">Profile</h1>

      {loading ? (
        <div className="mt-6 text-gray-600">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {/* Left: form */}
          <div className="rounded-xl border p-4 space-y-4">
            <div>
              <label className="text-sm font-medium">Business name</label>
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Business address</label>
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Phone</label>
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Website</label>
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  placeholder="example.com"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Contact email</label>
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-medium">About</label>
              <textarea
                className="mt-1 w-full rounded border px-3 py-2 min-h-[100px]"
                placeholder="Tell customers about your service…"
                value={about}
                onChange={(e) => setAbout(e.target.value)}
              />
            </div>

            {/* NEW: Payment methods */}
            <PaymentMethodsSelector value={paymentMethods} onChange={setPaymentMethods} />

            {/* Logo uploader */}
            <div className="space-y-2">
              <div className="text-sm font-medium">Logo (auto-resized to 300×300 PNG)</div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              />
              {logoUrl && (
                <div className="text-xs text-gray-600">
                  Preview shows the resized 300×300 image.
                </div>
              )}
              <div>
                <button
                  onClick={onSave}
                  disabled={saving}
                  className="mt-2 rounded bg-black px-4 py-2 text-white disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save settings"}
                </button>
              </div>
            </div>
          </div>

          {/* Right: preview */}
          <div className="rounded-xl border p-4">
            <div className="text-lg font-semibold mb-2">Business details (preview)</div>
            <div className="flex items-start gap-3">
              <div className="h-12 w-12 rounded bg-gray-100 overflow-hidden flex items-center justify-center">
                {logoUrl ? (
                  <img src={logoUrl} alt="logo" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs text-gray-400">Logo</span>
                )}
              </div>
              <div className="flex-1 space-y-1">
                {previewLines.map((l, i) => (
                  <div key={i} className={i === 0 ? "font-semibold" : "text-sm"}>{l}</div>
                ))}

                {/* NEW: Show selected payment methods */}
                {paymentMethods.length > 0 && (
                  <div className="pt-2">
                    <div className="text-xs font-medium text-gray-600 mb-1">
                      Accepts:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {PAYMENT_METHODS.filter(m => paymentMethods.includes(m.key)).map(m => (
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

                <p className="mt-2 text-[11px] text-gray-500">
                  This is a live preview of what customers will see on your public profile and quotes.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
