import React, { useEffect, useMemo, useState } from "react";

export type LegalTab = "terms" | "privacy" | "cookies" | "sponsored";

type Props = {
  open: boolean;
  onClose: () => void;
  defaultTab?: LegalTab;
  brandName?: string;
};

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function LegalModal({
  open,
  onClose,
  defaultTab = "terms",
  brandName = "Klean.ly",
}: Props) {
  const [tab, setTab] = useState<LegalTab>(defaultTab);

  useEffect(() => {
    if (open) setTab(defaultTab);
  }, [open, defaultTab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const tabs = useMemo(
    () => [
      { key: "terms" as const, label: "Terms" },
      { key: "privacy" as const, label: "Privacy" },
      { key: "cookies" as const, label: "Cookies" },
      { key: "sponsored" as const, label: "Sponsored Listings" },
    ],
    []
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <button
        aria-label="Close legal modal"
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative mx-auto mt-10 w-[min(980px,92vw)] rounded-2xl border border-white/10 bg-[#0b0b0b] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-white">Legal</div>
            <div className="text-sm text-white/60">
              {brandName} policies and terms
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
          >
            Close
          </button>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-white/10 px-5 py-3">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={classNames(
                "rounded-full px-4 py-2 text-sm transition",
                tab === t.key
                  ? "bg-white text-black"
                  : "bg-white/5 text-white hover:bg-white/10"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <main className="max-h-[70vh] overflow-y-auto px-5 py-5">
          {tab === "terms" && <TermsContent brandName={brandName} />}
          {tab === "privacy" && <PrivacyContent brandName={brandName} />}
          {tab === "cookies" && <CookieContent brandName={brandName} />}
          {tab === "sponsored" && <SponsoredContent brandName={brandName} />}
        </main>

        <div className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
          <div className="text-xs text-white/50">
            Last updated: <span className="text-white/70">January 25, 2026</span>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===================== CONTENT ===================== */

function TermsContent({ brandName }: { brandName: string }) {
  return (
    <article className="prose prose-invert max-w-none">
      <h2>Directory Terms</h2>
      <p>
        {brandName} operates as an <strong>online business directory</strong>. We
        do not provide bin cleaning services and are not a party to any agreement
        between customers and listed businesses.
      </p>

      <p>
        Sponsored or featured listings are paid advertisements only and do not
        constitute endorsements.
      </p>

      <p>
        To the maximum extent permitted by law, {brandName} accepts no liability
        for services provided by listed businesses.
      </p>

      <p>
        These terms are governed by the laws of England and Wales.
      </p>
    </article>
  );
}

function PrivacyContent({ brandName }: { brandName: string }) {
  return (
    <article className="prose prose-invert max-w-none">
      <h2>Privacy Policy</h2>
      <p>
        {brandName} is the data controller for personal data collected through
        this website.
      </p>

      <p>
        We collect only the data necessary to operate the directory, handle
        enquiries, manage business accounts, and maintain security.
      </p>

      <p>
        We do not sell personal data. You have rights under UK GDPR including
        access, correction, and the right to complain to the ICO.
      </p>
    </article>
  );
}

function CookieContent({ brandName }: { brandName: string }) {
  return (
    <article className="prose prose-invert max-w-none">
      <h2>Cookie Policy</h2>
      <p>
        {brandName} uses cookies and similar technologies to ensure the site
        functions correctly, remains secure, and improves usability.
      </p>

      <p>
        You can control cookies through your browser settings. Blocking some
        cookies may affect functionality.
      </p>
    </article>
  );
}

function SponsoredContent({ brandName }: { brandName: string }) {
  return (
    <article className="prose prose-invert max-w-none">
      <h2>Sponsored Listings</h2>
      <p>
        Sponsored Listings are paid advertising placements that affect visibility
        only.
      </p>

      <p>
        Payment does not constitute endorsement, recommendation, or verification
        of a business.
      </p>

      <p>
        {brandName} is not responsible for the services provided by sponsored
        businesses.
      </p>
    </article>
  );
}
