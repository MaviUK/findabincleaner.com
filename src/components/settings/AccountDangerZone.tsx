import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Props = {
  businessName?: string | null;
};

export default function AccountDangerZone({ businessName }: Props) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const expected = useMemo(() => (businessName?.trim() || "DELETE"), [businessName]);
  const canDelete = confirmText.trim() === expected && !busy;

  useEffect(() => setError(null), [confirmText]);

  const onDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;
      if (!token) throw new Error("No session");

      const res = await fetch("/.netlify/functions/deleteAccount", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      setDone(true);
      await supabase.auth.signOut();
      // Redirect to login (hash-router example)
      window.location.href = "/#/login";
    } catch (e: any) {
      setError(e?.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="border border-red-300 bg-red-50 text-red-900 rounded-2xl p-4">
        <div className="font-semibold">Account deleted</div>
        <p className="text-sm">You’ve been signed out.</p>
      </div>
    );
  }

  return (
    <div className="border border-red-300 bg-red-50 rounded-2xl p-5 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-red-800">Danger Zone</h3>
        <p className="text-sm text-red-700">
          Permanently delete your business account, including listings, service areas, files and login.
          This cannot be undone.
        </p>
      </div>

      <label className="block text-sm">
        Type{" "}
        <span className="font-mono bg-white px-1 py-0.5 rounded border">
          {expected}
        </span>{" "}
        to confirm:
      </label>
      <input
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        className="w-full border rounded-xl px-3 py-2"
        placeholder={expected}
      />

      {error && <div className="text-sm text-red-700">{error}</div>}

      <button
        onClick={onDelete}
        disabled={!canDelete}
        className={`px-4 py-2 rounded-xl text-white ${
          canDelete ? "bg-red-600 hover:bg-red-700" : "bg-red-300 cursor-not-allowed"
        }`}
      >
        {busy ? "Deleting…" : "Delete my account"}
      </button>
    </div>
  );
}
