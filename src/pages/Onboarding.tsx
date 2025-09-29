// src/pages/Onboarding.tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const TERMS_VERSION = "2025-09-29";

// You can replace this with a richer component or fetch from /#/terms if you prefer.
const TermsContent = () => (
  <div className="prose max-w-none">
    <h2>Cleenly Marketplace – Business Terms & Conditions</h2>
    <p><strong>Last updated:</strong> 29 September 2025</p>

    <p>
      These Terms govern your use of the Cleenly Marketplace. By creating an
      account or listing your business, you agree to these Terms.
    </p>

    <h3>1. Using the Service</h3>
    <ul>
      <li>You must be at least 18 and authorised to act for your business.</li>
      <li>You are responsible for your account and all activity under it.</li>
    </ul>

    <h3>2. Your Listing & Content</h3>
    <ul>
      <li>You are responsible for accuracy and legality of your listing.</li>
      <li>
        You grant us a non-exclusive, royalty-free licence to host and display your
        content for operating and promoting the service.
      </li>
    </ul>

    <h3>3. Service Areas & Availability</h3>
    <ul>
      <li>You must draw and maintain your service areas accurately.</li>
      <li>We are not party to any contract between you and consumers.</li>
    </ul>

    <h3>4. Reviews & Ratings</h3>
    <ul>
      <li>We may host reviews and may remove abusive or unlawful reviews.</li>
    </ul>

    <h3>5. Fees</h3>
    <ul>
      <li>Listings are currently free. We may introduce paid plans with notice.</li>
    </ul>

    <h3>6. Prohibited Conduct</h3>
    <ul>
      <li>No unlawful, infringing, or misleading content or activity.</li>
      <li>No scraping, reverse-engineering, or service interference.</li>
    </ul>

    <h3>7. Data Protection & Privacy</h3>
    <ul>
      <li>See our Privacy Notice. You control any off-platform customer data.</li>
    </ul>

    <h3>8. Availability & Changes</h3>
    <ul>
      <li>The service is provided “as is”. We may update or discontinue features.</li>
    </ul>

    <h3>9. Liability</h3>
    <ul>
      <li>We are not liable for your services to consumers.</li>
      <li>
        To the extent permitted by law, we exclude indirect/consequential losses.
        Our total liability is limited to £100 or fees paid in the prior 12 months.
      </li>
    </ul>

    <h3>10. Indemnity</h3>
    <ul>
      <li>
        You agree to indemnify us for claims arising from your listing, services, or
        breach of these Terms.
      </li>
    </ul>

    <h3>11. Termination</h3>
    <ul>
      <li>You may delete your account at any time.</li>
      <li>We may suspend or terminate for breach or legal reasons.</li>
    </ul>

    <h3>12. Governing Law</h3>
    <ul>
      <li>England &amp; Wales law, courts of England &amp; Wales have exclusive jurisdiction.</li>
    </ul>

    <p><strong>Contact:</strong> cleenlymarketplace@gmail.com</p>
    <p className="text-sm text-gray-500">
      Version: <code>v{TERMS_VERSION}</code>
    </p>
  </div>
);

export default function Onboarding() {
  const nav = useNavigate();
  const [checked, setChecked] = useState(false);
  const [scrolledEnd, setScrolledEnd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // If already accepted, bounce to settings
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { nav("/login", { replace: true }); return; }

      const { data: me, error } = await supabase
        .from("cleaners")
        .select("id, terms_accepted, terms_version")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!error && me?.terms_accepted && me.terms_version === TERMS_VERSION) {
        nav("/settings", { replace: true });
      }
    })();
  }, [nav]);

  // Track scroll progress to the bottom
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
    if (atBottom) setScrolledEnd(true);
  }

  async function accept() {
    try {
      setSaving(true);
      setErr(null);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not signed in.");

      // Ensure a cleaners row exists
      let cleanerId: string | null = null;
      {
        const { data: row, error } = await supabase
          .from("cleaners")
          .select("id")
          .eq("user_id", session.user.id)
          .maybeSingle();
        if (error) throw error;

        if (row?.id) {
          cleanerId = row.id;
        } else {
          const { data: created, error: insErr } = await supabase
            .from("cleaners")
            .insert({ user_id: session.user.id, business_name: null })
            .select("id")
            .single();
          if (insErr) throw insErr;
          cleanerId = created!.id;
        }
      }

      const { error: updErr } = await supabase
        .from("cleaners")
        .update({
          terms_accepted: true,
          terms_version: TERMS_VERSION,
          terms_accepted_at: new Date().toISOString(),
          // Optional: auto-publish
          // is_published: true,
        })
        .eq("id", cleanerId!);

      if (updErr) throw updErr;

      nav("/settings", { replace: true });
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Could not save acceptance.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10 space-y-6">
      <h1 className="text-2xl font-bold">Terms &amp; Conditions</h1>

      {/* Scrollable terms box */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="border rounded-lg bg-white p-4 max-h-[50vh] overflow-y-auto"
      >
        <TermsContent />
      </div>

      {!scrolledEnd && (
        <p className="text-sm text-gray-600">
          Please scroll to the bottom to enable the agreement.
        </p>
      )}

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          disabled={!scrolledEnd}
        />
        <span>I have read and agree to the Business Terms &amp; Conditions.</span>
      </label>

      {err && <div className="text-sm text-red-700">{err}</div>}

      <button
        disabled={!checked || !scrolledEnd || saving}
        onClick={accept}
        className="rounded-lg px-4 py-2 bg-emerald-700 text-white disabled:opacity-60"
      >
        {saving ? "Saving…" : "Agree & continue"}
      </button>
    </main>
  );
}
