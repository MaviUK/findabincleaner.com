import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

// keep in one place so you can bump this when T&Cs change
const TERMS_VERSION = "v2025-09-29";

export default function Onboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);

  const scrollBoxRef = useRef<HTMLDivElement | null>(null);

  // Fetch user and short-circuit if already accepted
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const {
        data: { user },
        error: uErr,
      } = await supabase.auth.getUser();

      if (uErr) {
        if (!cancelled) setError(uErr.message);
        setLoading(false);
        return;
      }
      if (!user) {
        // no session, kick to login
        navigate("/login", { replace: true });
        return;
      }

      // check profile for terms acceptance
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("id, terms_version, terms_accepted_at")
        .eq("id", user.id)
        .maybeSingle();

      if (pErr) {
        if (!cancelled) setError(pErr.message);
        setLoading(false);
        return;
      }

      if (profile?.terms_accepted_at && profile?.terms_version === TERMS_VERSION) {
        // already accepted this version — go to dashboard
        navigate("/dashboard", { replace: true });
        return;
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // Enable button only when both conditions true
  const canAgree = useMemo(() => checked && scrolledToEnd && !saving, [checked, scrolledToEnd, saving]);

  // Track scroll position
  useEffect(() => {
    const el = scrollBoxRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8; // small tolerance
      setScrolledToEnd(atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // run once in case content already smaller than box
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const handleAgree = async () => {
    setSaving(true);
    setError(null);

    const {
      data: { user },
      error: uErr,
    } = await supabase.auth.getUser();

    if (uErr || !user) {
      setError(uErr?.message || "You need to be signed in.");
      setSaving(false);
      return;
    }

    const payload = {
      terms_version: TERMS_VERSION,
      terms_accepted_at: new Date().toISOString(),
    };

    // Try update first (normal path if you have auth trigger creating profiles)
    const { data: updated, error: upErr } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", user.id)
      .select("id");

    if (upErr) {
      setError(upErr.message);
      setSaving(false);
      return;
    }

    // If no row was updated (rare if profile didn’t exist), insert it
    if (!updated || updated.length === 0) {
      const { error: insErr } = await supabase.from("profiles").insert({
        id: user.id,
        ...payload,
      });
      if (insErr) {
        setError(insErr.message);
        setSaving(false);
        return;
      }
    }

    // IMPORTANT: do NOT create a cleaners row here.
    // We’ll collect business_name on Settings.
    navigate("/settings?firstRun=1", { replace: true });
  };

  if (loading) {
    return (
      <div className="container mx-auto max-w-2xl px-4 sm:px-6 py-10">
        <div className="text-lg">Loading…</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 sm:px-6 py-8">
      <h1 className="text-3xl font-extrabold tracking-tight mb-4">Terms &amp; Conditions</h1>

      <div
        ref={scrollBoxRef}
        className="border rounded-2xl p-4 sm:p-5 bg-white shadow-sm max-h-96 overflow-y-auto"
      >
        {/* --- Your T&Cs content below. Keep the version visible. --- */}
        <p className="text-sm leading-6 text-gray-900">
          Our total liability is limited to £100 or fees paid in the prior 12 months.
        </p>
        <p className="mt-3 text-sm leading-6 text-gray-900 font-semibold">10. Indemnity</p>
        <p className="text-sm leading-6 text-gray-900">
          You agree to indemnify us for claims arising from your listing, services, or breach of these Terms.
        </p>
        <p className="mt-3 text-sm leading-6 text-gray-900 font-semibold">11. Termination</p>
        <p className="text-sm leading-6 text-gray-900">
          You may delete your account at any time. We may suspend or terminate for breach or legal reasons.
        </p>
        <p className="mt-3 text-sm leading-6 text-gray-900 font-semibold">12. Governing Law</p>
        <p className="text-sm leading-6 text-gray-900">
          England &amp; Wales law, courts of England &amp; Wales have exclusive jurisdiction.
        </p>
        <p className="mt-4 text-sm leading-6 text-gray-900">
          <span className="font-semibold">Contact:</span> cleenlymarketplace@gmail.com
        </p>
        <p className="mt-1 text-xs text-gray-600">Version: {TERMS_VERSION}</p>
      </div>

      <div className="mt-5 flex items-start gap-3">
        <input
          id="agree"
          type="checkbox"
          className="mt-1 h-5 w-5 rounded border-gray-300"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <label htmlFor="agree" className="text-sm sm:text-base leading-6 text-gray-900">
          I have read and agree to the Business Terms &amp; Conditions.
          {!scrolledToEnd && (
            <span className="block text-xs text-gray-500 mt-1">
              Scroll to the bottom of the Terms to enable the button.
            </span>
          )}
        </label>
      </div>

      {error && (
        <div className="mt-4 text-sm text-red-600">
          {error}
        </div>
      )}

      <button
        onClick={handleAgree}
        disabled={!canAgree}
        className={`mt-6 w-full sm:w-auto inline-flex items-center justify-center rounded-xl px-5 py-3 font-semibold text-white
          ${canAgree ? "bg-emerald-700 hover:bg-emerald-800" : "bg-gray-300 cursor-not-allowed"}`}
      >
        {saving ? "Saving…" : "Agree & continue"}
      </button>
    </div>
  );
}
