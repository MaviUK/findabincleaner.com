// src/pages/Onboarding.tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const TERMS_VERSION = "2025-09-29";

const TermsContent = () => (
  <div className="prose max-w-none">
    <h2>Kleanly – Business Terms & Conditions</h2>
    <p><strong>Last updated:</strong> 29 September 2025</p>
    <p>
  These Business Terms & Conditions ("Terms") govern your use of the Kleanly
  Marketplace ("Platform", "we", "us", "our"). By creating an account, listing
  your business, or purchasing any services, you agree to be bound by these Terms.
</p>

<h3>1. Platform Role</h3>
<ul>
  <li>
    Kleanly operates an online marketplace connecting consumers with independent
    service providers.
  </li>
  <li>
    We are not a party to any agreement between you and consumers and do not act
    as your agent, partner, employee, or representative.
  </li>
  <li>
    You provide services in your own name and at your own risk.
  </li>
</ul>

<h3>2. Eligibility & Account Responsibility</h3>
<ul>
  <li>You must be at least 18 years old and authorised to act for your business.</li>
  <li>
    You are responsible for maintaining accurate account information and for all
    activity carried out under your account.
  </li>
  <li>
    You must notify us immediately of any unauthorised use of your account.
  </li>
</ul>

<h3>3. Listings, Content & Service Areas</h3>
<ul>
  <li>
    You are solely responsible for the accuracy, legality, and completeness of
    your business listing, pricing, service descriptions, and availability.
  </li>
  <li>
    You must draw and maintain your service areas accurately and keep them up to
    date.
  </li>
  <li>
    You confirm that you own or have permission to use all content you upload.
  </li>
  <li>
    You grant us a non-exclusive, worldwide, royalty-free licence to host, display,
    reproduce, and promote your content for operating and marketing the Platform.
  </li>
  <li>
    We may edit, remove, or suspend listings that are misleading, unlawful, or
    breach these Terms.
  </li>
</ul>

<h3>4. Services to Consumers</h3>
<ul>
  <li>
    All services are provided directly by you to consumers. You are solely
    responsible for service quality, scheduling, pricing, cancellations,
    refunds, and dispute resolution.
  </li>
  <li>
    We do not guarantee any number of enquiries, bookings, or revenue.
  </li>
</ul>

<h3>5. Reviews & Ratings</h3>
<ul>
  <li>
    Consumers may leave reviews based on their experience.
  </li>
  <li>
    We may remove reviews that are abusive, unlawful, or breach our content
    policies but do not verify their accuracy.
  </li>
  <li>
    You must not manipulate, fabricate, or incentivise reviews.
  </li>
</ul>

<h3>6. Fees, Payments & Sponsorships</h3>
<ul>
  <li>
    Listings may be free or paid depending on your plan. We may introduce or
    change fees with reasonable notice.
  </li>
  <li>
    Paid plans, featured placements, or sponsored service areas provide increased
    visibility only and do not guarantee enquiries or bookings.
  </li>
  <li>
    All fees are non-refundable unless required by law or explicitly stated.
  </li>
  <li>
    Failure to pay may result in suspension or removal of your listing.
  </li>
</ul>

<h3>7. Insurance & Compliance</h3>
<ul>
  <li>
    You are responsible for holding all licences, approvals, and insurance
    required to provide your services, including public liability insurance
    where applicable.
  </li>
  <li>
    You confirm compliance with all applicable laws and regulations.
  </li>
</ul>

<h3>8. Prohibited Conduct</h3>
<ul>
  <li>No unlawful, misleading, infringing, or deceptive content or activity.</li>
  <li>No scraping, data harvesting, reverse engineering, or interference with
    the Platform.
  </li>
  <li>No attempts to bypass fees, rankings, or sponsored placements.</li>
</ul>

<h3>9. Availability & Changes</h3>
<ul>
  <li>
    The Platform is provided “as is” and “as available”.
  </li>
  <li>
    We may modify, suspend, or discontinue any part of the Platform at any time.
  </li>
</ul>

<h3>10. Limitation of Liability</h3>
<ul>
  <li>
    We are not liable for your services, consumer interactions, property damage,
    personal injury, or disputes.
  </li>
  <li>
    To the maximum extent permitted by law, we exclude liability for indirect,
    incidental, or consequential losses.
  </li>
  <li>
    Our total aggregate liability is limited to the greater of £250 or the fees
    paid by you to us in the preceding 12 months.
  </li>
</ul>

<h3>11. Indemnity</h3>
<ul>
  <li>
    You agree to indemnify and hold us harmless from all claims, losses,
    liabilities, damages, costs, and expenses arising from:
    <ul>
      <li>Your listing or content</li>
      <li>Your services to consumers</li>
      <li>Your breach of these Terms</li>
    </ul>
  </li>
</ul>

<h3>12. Suspension & Termination</h3>
<ul>
  <li>You may delete your account at any time.</li>
  <li>
    We may suspend or terminate your account immediately if you breach these
    Terms, act unlawfully, or pose risk to consumers or the Platform.
  </li>
</ul>

<h3>13. Data Protection</h3>
<ul>
  <li>
    We process personal data in accordance with our Privacy Notice and UK GDPR.
  </li>
  <li>
    You are responsible for lawful handling of any customer data obtained
    outside the Platform.
  </li>
</ul>

<h3>14. Governing Law</h3>
<ul>
  <li>
    These Terms are governed by the laws of England and Wales.
  </li>
  <li>
    The courts of England and Wales have exclusive jurisdiction.
  </li>
</ul>

<p>
  <strong>Contact:</strong> support@klean.ly
</p>
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

      // 1) Find existing row
      let { data: row, error: fetchErr } = await supabase
        .from("cleaners")
        .select("id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;

      // 2) Create if missing — plain INSERT (no upsert / no select)
      if (!row?.id) {
        const fallbackName =
          (session.user.user_metadata as any)?.business_name ??
          (session.user.user_metadata as any)?.name ??
          (session.user.email ? `${session.user.email.split("@")[0]} Bin Cleaning` : "New Cleaner");

        const { error: insErr } = await supabase.from("cleaners").insert({
          user_id: session.user.id,
          business_name: String(fallbackName).slice(0, 120),
        });
        if (insErr) throw insErr;

        // Re-fetch id
        const again = await supabase
          .from("cleaners")
          .select("id")
          .eq("user_id", session.user.id)
          .maybeSingle();
        if (again.error) throw again.error;
        row = again.data;
      }

      // 3) Mark terms accepted
      const { error: updErr } = await supabase
        .from("cleaners")
        .update({
          terms_accepted: true,
          terms_version: TERMS_VERSION,
          terms_accepted_at: new Date().toISOString(),
        })
        .eq("id", row!.id);
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
