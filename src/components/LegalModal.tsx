import React, { useEffect, useMemo, useState } from "react";

export type LegalTab = "terms" | "privacy" | "cookies" | "sponsored";

type Props = {
  open: boolean;
  onClose: () => void;
  defaultTab?: LegalTab;
  brandName?: string; // optional
};

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function LegalModal({
  open,
  onClose,
  defaultTab = "terms",
  brandName = "Ni Bin Guy",
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
      {/* backdrop */}
      <button
        aria-label="Close legal modal"
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />

      {/* panel */}
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

        {/* tab bar */}
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

        {/* content */}
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-base font-semibold text-white">{title}</h2>
      <div className="space-y-2 text-sm leading-6 text-white/80">{children}</div>
    </section>
  );
}

function TermsContent({ brandName }: { brandName: string }) {
  return (
    <article className="prose prose-invert max-w-none">
      <Section title="1. Overview">
        <p>
          These terms govern use of the {brandName} website and any related
          services. By using the site, you agree to these terms.
        </p>
      </Section>

      <Section title="2. Bookings & Payments">
        <p>
          Where bookings or payments are offered, you agree to provide accurate
          information. Any quoted prices may change if service requirements
          change.
        </p>
      </Section>

      <Section title="3. Acceptable Use">
        <p>
          You must not misuse the site (including attempting to gain unauthorised
          access, scraping at abusive rates, or interfering with normal
          operation).
        </p>
      </Section>

      <Section title="4. Liability">
        <p>
          We provide the site “as is”. To the fullest extent permitted by law,
          we exclude liability for indirect or consequential loss.
        </p>
      </Section>

      <Section title="5. Contact">
        <p>
          If you have questions about these terms, contact us via the site
          contact form.
        </p>
      </Section>
    </article>
  );
}

function PrivacyContent({ brandName }: { brandName: string }) {
  return (
    <article className="prose prose-invert max-w-none">
      <Section title="1. What we collect">
        <p>
          {brandName} may collect information you submit (e.g. name, email,
          phone, address) for booking and support purposes.
        </p>
      </Section>

      <Section title="2. How we use it">
        <p>
          We use your information to provide services, respond to enquiries, and
          improve the site. We do not sell your personal data.
        </p>
      </Section>

      <Section title="3. Data retention">
        <p>
          We keep personal data only as long as necessary for the purposes above
          (or to meet legal obligations).
        </p>
      </Section>

      <Section title="4. Your rights">
        <p>
          You may request access, correction, or deletion of your personal data
          where applicable.
        </p>
      </Section>
    </article>
  );
}

function CookieContent({ brandName }: { brandName: string }) {
  return (
    <article className="prose prose-invert max-w-none">
      <Section title="1. Cookies">
        <p>
          {brandName} uses cookies and similar technologies to help the site
          function and to understand usage.
        </p>
      </Section>

      <Section title="2. Managing cookies">
        <p>
          You can control cookies in your browser settings. Disabling cookies
          may affect site functionality.
        </p>
      </Section>
    </article>
  );
}

function SponsoredContent({ brandName }: { brandName: string }) {
  return (
    <article className="prose prose-invert max-w-none">
      <Section title="1. Sponsored listings">
        <p>
          Sponsored listings are paid placements. We may display a business more
          prominently in certain areas/categories where sponsorship is active.
        </p>
      </Section>

      <Section title="2. No endorsement">
        <p>
          Displaying a sponsored listing does not necessarily mean {brandName} endorses
          that business. Users should perform their own checks before engaging
          any provider.
        </p>
      </Section>
    </article>
  );
}
