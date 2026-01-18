// src/pages/Onboarding.tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const TERMS_VERSION = "2025-09-29";

const TermsContent = () => (
  <div className="max-w-none text-gray-900">
    <h2 className="text-xl font-extrabold">Kleanly – Business Terms &amp; Conditions</h2>

    <p className="mt-2 text-sm text-gray-600">
      <strong>Last updated:</strong> 29 September 2025
    </p>

    <p className="mt-4 leading-7">
      These Business Terms &amp; Conditions ("Terms") govern your use of the Kleanly
      Marketplace ("Platform", "we", "us", "our"). By creating an account, listing
      your business, or purchasing any services, you agree to be bound by these Terms.
    </p>

    {/* --- Section 1 --- */}
    <div className="h-5" />
    <h3 className="text-lg font-bold">1. Platform Role</h3>
    <p className="mt-2 leading-7">
      Kleanly operates an online marketplace connecting consumers with independent service providers.
    </p>
    <ul className="mt-2 list-disc pl-5 space-y-1">
      <li>
        We are not a party to any agreement between you and consumers and do not act as your agent,
        partner, employee, or representative.
      </li>
      <li>You provide services in your own name and at your own risk.</li>
    </ul>

    {/* --- Section 2 --- */}
    <div className="h-5" />
    <h3 className="text-lg font-bold">2. Eligibility &amp; Account Responsibility</h3>
    <p className="mt-2 leading-7">To use the Platform as a business, you must meet the following conditions:</p>
    <ul className="mt-2 list-disc pl-5 space-y-1">
      <li>You must be at least 18 years old and authorised to act for your business.</li>
      <li>You are responsible for maintaining accurate account information and for all activity carried out under your account.</li>
      <li>You must notify us immediately of any unauthorised use of your account.</li>
    </ul>

    {/* --- Section 3 --- */}
    <div className="h-5" />
    <h3 className="text-lg font-bold">3. Listings, Content &amp; Service Areas</h3>
    <p className="mt-2 leading-7">
      You control what you publish on the Platform and are responsible for keeping it accurate and lawful.
    </p>
    <ul className="mt-2 list-disc pl-5 space-y-1">
      <li>You are solely responsible for the accuracy, legality, and completeness of your business listing, pricing, service descriptions, and availability.</li>
      <li>You must draw and maintain your service areas accurately and keep them up to date.</li>
      <li>You confirm that you own or have permission to use all content you upload.</li>
      <li>You grant us a non-exclusive, worldwide, royalty-free licence to host, display, reproduce, and promote your content for operating and marketing the Platform.</li>
      <li>We may edit, remove, or suspend listings that are misleading, unlawful, or breach these Terms.</li>
    </ul>

    {/* --- Section 4 --- */}
    <div className="h-5" />
    <h3 className="text-lg font-bold">4. Services to Consumers</h3>
    <p className="mt-2 leading-7">
      Any work booked through Kleanly is provided by you directly to the consumer.
    </p>
    <ul className="mt-2 list-disc pl-5 space-y-1">
      <li>You are solely responsible for service quality, scheduling, pricing, cancellations, refunds, and dispute resolution.</li>
      <li>We do not guarantee any number of enquiries, bookings, or revenue.</li>
    </ul>

    {/* --- Section 5 --- */}
    <div className="h-5" />
    <h3 className="text-lg font-bold">5. Reviews &amp; Ratings</h3>
    <p className="mt-2 leading-7">Consumers may leave reviews based on their experience of your services.</p>
    <ul className="mt-2 list-disc pl-5 space-y-1">
      <li>We may remove reviews that are abusive, unlawful, or breach our policies.</li>
      <li>We do not verify the accuracy of reviews.</li>
      <li>You must not manipulate, fabricate, or incentivise reviews.</li>
    </ul>

    {/* --- Section 6 --- */}
    <div className="h-5" />
    <h3 className="text-lg font-bold">6. Fees, Payments &amp; Sponsorships</h3>
    <p className="mt-2 leading-7">Some features may be free or paid depending on your plan and selections.</p>
    <ul className="mt-2 list-disc pl-5 space-y-1">
      <li>Listings may be free or paid depending on your plan. We may introduce or change fees with reasonable notice.</li>
      <li>Paid plans, featured placements, or sponsored service areas provide increased visibility only and do not guarantee enquiries or bookings.</li>
      <li>All fees are non-refundable unless required by law or explicitly stated.</li>
      <li>Failure to pay may result in suspension or removal of your listing.</li>
    </ul>

    {/* --- Section 7 --- */}
    <div className="h-5" />
    <h3 className="text-lg font-bold">7. Insurance &amp; Compliance</h3>
    <p className="mt-2 leading-7">
      You are responsible for meeting all legal and insurance requirements for your services.
    </p>
    <ul className="mt-2 list-disc pl-5 space-y-1">
      <li>You are responsible for holding all licences, approvals, and insurance required to provide your services, including public liability insurance where applicable.</li>
      <li>You confirm compliance with all applicable laws and regulations.</li>
    </ul>

    {/* --- Section 8 --- */}
    <div className="h-5" />
    <h3 className="text-lg font-bold">8. Prohibited Conduct</h3>
    <p className="mt-2 leading-7">You must not misuse the Platform or harm its operation.</p>
    <ul className="mt-2 list-disc pl-5 space-y-1">
      <li>No unlawful, misleading, infringing, or deceptive content or activity.</li>
      <li>No scraping, data harvesting, reverse engineering, or interference with the Platform.</li>
      <li>No attempts to bypass fees, rankings, or sponsored placements.</li>
    </ul>

    {/* --- Section 9 --- */}
    <div className="h-5" />
    <h3 className="text-lg font-bold">9. Availability &amp; Changes</h3>
    <p className="mt-2 leading-7">We may update the Platform over time and cannot guarantee uninterrupted access.</p>
    <ul className="mt-2 list-disc pl-5 space-y-1">
      <li>The Platform is provided “as is” and “as available”.</li>
      <li>We may modify, suspend, or discontinue any part of the Platform at any time.</li>
    </ul>

    {/* --- Section 10 --- */}
    <div className="h-5" />
    <h3 className="text-lg font-bold">10. Limitation of Liability</h3>
    <p className="mt-2 leading-7">Your relationship with consumers is your responsibility. Our liability is limited as set out below.</p>
    <ul className="mt-2 list-disc pl-5 space-y-1">
      <li>We are not liable for your services, consumer interactions, property damage, personal injury, or disputes.</li>
      <li>To the maximum extent permitted by law, we exclude liability for indirect, incidental, or consequential losses.</li>
      <li>Our total aggregate liability is limited to the greater of £250 or the fees paid by you to us in the preceding 12 months.</li>
    </ul>

    {/* --- Section 11 --- */}
    <div className="h-5" />
    <h3 className="text-lg font-bold">11. Indemnity</h3>
    <p className="mt-2 leading-7">You agree to protect us from claims connected with your listing and services.</p>
    <ul className="mt-2 list-disc pl-5 space-y-1">
      <li>
        You agree to indemnify and hold us harmless from all claims, losses, liabilities, damages,
        costs, and expenses arising from:
        <ul className="mt-2 list-disc pl-5 space-y-1">
          <li>Your listing or content</li>
          <li>Your services to consumers</li>
          <li>Your breach of these Terms</li>
        </ul>
      </li>
    </ul>

    {/* --- Section 12 --- */}
    <div className="h-5" />
    <h3 className="text-lg font-bold">12. Suspension &amp; Termination</h3>
    <p className="mt-2 leading-7">We may remove access to protect consumers and the Platform.</p>
    <ul className="mt-2 list-disc pl-5 space-y-1">
      <li>You may delete your account at any time.</li>
      <li>We may suspend or terminate your account immediately if you breach these Terms, act unlawfully, or pose risk to consumers or the Platform.</li>
    </ul>

    {/* --- Section 13 --- */}
    <div className="h-5" />
    <h3 className="text-lg font-bold">13. Data Protection</h3>
    <p className="mt-2 leading-7">We process personal data in line with our Privacy Notice. You must handle customer data lawfully.</p>
    <ul className="mt-2 list-disc pl-5 space-y-1">
      <li>We process personal data in accordance with our Privacy Notice and UK GDPR.</li>
      <li>You are responsible for lawful handling of any customer data obtained outside the Platform.</li>
    </ul>

    {/* --- Section 14 --- */}
    <div className="h-5" />
    <h3 className="text-lg font-bold">14. Governing Law</h3>
    <p className="mt-2 leading-7">These Terms are governed by the laws stated below.</p>
    <ul className="mt-2 list-disc pl-5 space-y-1">
      <li>These Terms are governed by the laws of England and Wales.</li>
      <li>The courts of England and Wales have exclusive jurisdiction.</li>
    </ul>

    <div className="h-5" />
    <p className="leading-7">
      <strong>Contact:</strong> support@klean.ly
    </p>

    <p className="mt-2 text-sm text-gray-500">
      Version: <code className="px-1 py-0.5 rounded bg-gray-100">v{TERMS_VERSION}</code>
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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        nav("/login", { replace: true });
        return;
      }

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

      const {
        data: { session },
      } = await supabase.auth.getSession();
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
          (session.user.email
            ? `${session.user.email.split("@")[0]} Bin Cleaning`
            : "New Cleaner");

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
