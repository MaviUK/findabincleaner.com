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
      <section>
        <h2>1. About this website</h2>
        <p>
          {brandName} operates as an <strong>online business directory</strong>.
          We list independent bin cleaning businesses operating in the United Kingdom.
        </p>
        <p>
          We do <strong>not</strong> provide bin cleaning services and we are
          <strong> not a party</strong> to any agreement between customers and listed businesses.
        </p>
      </section>

      <section>
        <h2>2. Using the directory</h2>
        <p>
          The website allows users to search for and contact bin cleaning businesses.
          Any enquiry, quotation, booking, or service is strictly between the user
          and the listed business.
        </p>
        <p>
          We do not guarantee the availability, pricing, quality, or suitability of
          any business listed on the site.
        </p>
      </section>

      <section>
        <h2>3. Sponsored and featured listings</h2>
        <p>
          Some businesses may appear as <strong>Sponsored</strong> or
          <strong> Featured</strong>. These placements are paid advertisements.
        </p>
        <p>
          Sponsored placement affects visibility only and does not constitute an
          endorsement, recommendation, or verification of the business.
        </p>
      </section>

      <section>
        <h2>4. Enquiries and contact</h2>
        <p>
          When you submit an enquiry through the site, your details are forwarded
          directly to the selected business.
        </p>
        <p>
          We are not responsible for responses, pricing, availability, service quality,
          or the outcome of any interaction between users and businesses.
        </p>
      </section>

      <section>
        <h2>5. Business accounts</h2>
        <p>Businesses listed on the site confirm that:</p>
        <ul>
          <li>The information they provide is accurate and kept up to date</li>
          <li>They have the right to offer the services listed</li>
          <li>They comply with applicable UK laws and regulations</li>
        </ul>
        <p>
          We reserve the right to suspend or remove listings that breach these terms.
        </p>
      </section>

      <section>
        <h2>6. Payments and subscriptions</h2>
        <p>
          Any payments made to {brandName} relate solely to advertising,
          sponsorship, or listing services.
        </p>
        <p>
          We do not handle customer payments for bin cleaning services.
          Subscription fees are non-refundable unless stated otherwise.
        </p>
      </section>

      <section>
        <h2>7. Liability</h2>
        <p>
          To the maximum extent permitted by law, {brandName} accepts no liability
          for services provided by listed businesses.
        </p>
        <p>
          We are not responsible for loss, damage, disputes, or dissatisfaction
          arising from the use of services obtained via the directory.
        </p>
      </section>

      <section>
        <h2>8. Availability</h2>
        <p>
          We aim to keep the website available and accurate but do not guarantee
          uninterrupted or error-free operation.
        </p>
      </section>

      <section>
        <h2>9. Changes to these terms</h2>
        <p>
          We may update these Terms from time to time. Continued use of the website
          constitutes acceptance of the updated terms.
        </p>
      </section>

      <section>
        <h2>10. Governing law</h2>
        <p>
          These Terms and Conditions are governed by the laws of England and Wales.
          Any disputes are subject to the exclusive jurisdiction of the UK courts.
        </p>
      </section>

      <section>
        <h2>11. Contact</h2>
        <p>
          If you have questions about these terms, please contact us via the
          details provided on the website.
        </p>
      </section>
    </article>
  );
}


function PrivacyContent({ brandName }: { brandName: string }) {
  return (
    <article className="prose prose-invert max-w-none">
      <section>
        <h2>1. Who we are</h2>
        <p>
          {brandName} operates an online business directory for bin cleaning
          services in the United Kingdom.
        </p>
        <p>
          For the purposes of UK data protection law, we are the
          <strong> data controller</strong> in relation to personal data
          collected through this website.
        </p>
      </section>

      <section>
        <h2>2. What data we collect</h2>

        <h3>Visitors</h3>
        <ul>
          <li>Postcode or location entered into the search</li>
          <li>IP address and basic device information</li>
          <li>Usage data such as pages viewed</li>
          <li>Cookie and local storage data</li>
        </ul>

        <h3>Enquiries</h3>
        <ul>
          <li>Name</li>
          <li>Email address</li>
          <li>Telephone number (if provided)</li>
          <li>Message content</li>
        </ul>

        <h3>Registered businesses</h3>
        <ul>
          <li>Business name and contact details</li>
          <li>Service areas and categories</li>
          <li>Account and login information</li>
        </ul>
      </section>

      <section>
        <h2>3. How we collect data</h2>
        <ul>
          <li>When you search for businesses on the website</li>
          <li>When you submit an enquiry or contact form</li>
          <li>When a business registers or manages its listing</li>
          <li>Automatically through cookies and similar technologies</li>
        </ul>
      </section>

      <section>
        <h2>4. How we use your data</h2>
        <ul>
          <li>To operate and improve the directory</li>
          <li>To display relevant local search results</li>
          <li>To pass enquiries to selected businesses</li>
          <li>To manage business accounts and subscriptions</li>
          <li>To maintain security and prevent abuse</li>
          <li>To comply with legal obligations</li>
        </ul>
      </section>

      <section>
        <h2>5. Legal basis for processing</h2>
        <p>
          We process personal data under the following lawful bases:
        </p>
        <ul>
          <li>
            <strong>Legitimate interests</strong> – operating a business directory
            and responding to enquiries
          </li>
          <li>
            <strong>Consent</strong> – where you voluntarily submit information
          </li>
          <li>
            <strong>Contract</strong> – where businesses sign up for paid listings
          </li>
          <li>
            <strong>Legal obligation</strong> – where required by law
          </li>
        </ul>
      </section>

      <section>
        <h2>6. Sharing your data</h2>
        <p>
          We may share personal data with trusted third parties only where
          necessary to operate the website, including:
        </p>
        <ul>
          <li>Hosting and infrastructure providers</li>
          <li>Email delivery services</li>
          <li>Payment processors (for business subscriptions only)</li>
          <li>Analytics and security providers</li>
        </ul>
        <p>
          We do <strong>not</strong> sell personal data.
        </p>
      </section>

      <section>
        <h2>7. Cookies</h2>
        <p>
          We use cookies and similar technologies to enable core site
          functionality, support login and security, load maps, and analyse
          usage where permitted.
        </p>
        <p>
          Further details are provided in the Cookie Policy.
        </p>
      </section>

      <section>
        <h2>8. Data retention</h2>
        <p>
          Personal data is retained only for as long as necessary for the
          purposes outlined in this policy or to meet legal requirements.
        </p>
      </section>

      <section>
        <h2>9. Your rights</h2>
        <p>
          Under UK GDPR, you have rights including the right to:
        </p>
        <ul>
          <li>Access your personal data</li>
          <li>Request correction or deletion</li>
          <li>Object to or restrict processing</li>
          <li>Data portability (where applicable)</li>
          <li>Lodge a complaint with the ICO</li>
        </ul>
      </section>

      <section>
        <h2>10. Security</h2>
        <p>
          We use appropriate technical and organisational measures to protect
          personal data, including secure hosting and encrypted connections.
        </p>
      </section>

      <section>
        <h2>11. External links</h2>
        <p>
          This website may contain links to third-party websites. We are not
          responsible for their privacy practices.
        </p>
      </section>

      <section>
        <h2>12. Changes to this policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Any changes will
          be posted on this page.
        </p>
      </section>

      <section>
        <h2>13. Contact</h2>
        <p>
          If you have questions about this Privacy Policy or wish to exercise
          your rights, please contact us via the details provided on the website.
        </p>
      </section>
    </article>
  );
}


function PrivacyContent({ brandName }: { brandName: string }) {
  return (
    <article className="prose prose-invert max-w-none">
      <section>
        <h2>1. Who we are</h2>
        <p>
          {brandName} operates an online business directory for bin cleaning
          services in the United Kingdom.
        </p>
        <p>
          For the purposes of UK data protection law, we are the
          <strong> data controller</strong> in relation to personal data
          collected through this website.
        </p>
      </section>

      <section>
        <h2>2. What data we collect</h2>

        <h3>Visitors</h3>
        <ul>
          <li>Postcode or location entered into the search</li>
          <li>IP address and basic device information</li>
          <li>Usage data such as pages viewed</li>
          <li>Cookie and local storage data</li>
        </ul>

        <h3>Enquiries</h3>
        <ul>
          <li>Name</li>
          <li>Email address</li>
          <li>Telephone number (if provided)</li>
          <li>Message content</li>
        </ul>

        <h3>Registered businesses</h3>
        <ul>
          <li>Business name and contact details</li>
          <li>Service areas and categories</li>
          <li>Account and login information</li>
        </ul>
      </section>

      <section>
        <h2>3. How we collect data</h2>
        <ul>
          <li>When you search for businesses on the website</li>
          <li>When you submit an enquiry or contact form</li>
          <li>When a business registers or manages its listing</li>
          <li>Automatically through cookies and similar technologies</li>
        </ul>
      </section>

      <section>
        <h2>4. How we use your data</h2>
        <ul>
          <li>To operate and improve the directory</li>
          <li>To display relevant local search results</li>
          <li>To pass enquiries to selected businesses</li>
          <li>To manage business accounts and subscriptions</li>
          <li>To maintain security and prevent abuse</li>
          <li>To comply with legal obligations</li>
        </ul>
      </section>

      <section>
        <h2>5. Legal basis for processing</h2>
        <p>
          We process personal data under the following lawful bases:
        </p>
        <ul>
          <li>
            <strong>Legitimate interests</strong> – operating a business directory
            and responding to enquiries
          </li>
          <li>
            <strong>Consent</strong> – where you voluntarily submit information
          </li>
          <li>
            <strong>Contract</strong> – where businesses sign up for paid listings
          </li>
          <li>
            <strong>Legal obligation</strong> – where required by law
          </li>
        </ul>
      </section>

      <section>
        <h2>6. Sharing your data</h2>
        <p>
          We may share personal data with trusted third parties only where
          necessary to operate the website, including:
        </p>
        <ul>
          <li>Hosting and infrastructure providers</li>
          <li>Email delivery services</li>
          <li>Payment processors (for business subscriptions only)</li>
          <li>Analytics and security providers</li>
        </ul>
        <p>
          We do <strong>not</strong> sell personal data.
        </p>
      </section>

      <section>
        <h2>7. Cookies</h2>
        <p>
          We use cookies and similar technologies to enable core site
          functionality, support login and security, load maps, and analyse
          usage where permitted.
        </p>
        <p>
          Further details are provided in the Cookie Policy.
        </p>
      </section>

      <section>
        <h2>8. Data retention</h2>
        <p>
          Personal data is retained only for as long as necessary for the
          purposes outlined in this policy or to meet legal requirements.
        </p>
      </section>

      <section>
        <h2>9. Your rights</h2>
        <p>
          Under UK GDPR, you have rights including the right to:
        </p>
        <ul>
          <li>Access your personal data</li>
          <li>Request correction or deletion</li>
          <li>Object to or restrict processing</li>
          <li>Data portability (where applicable)</li>
          <li>Lodge a complaint with the ICO</li>
        </ul>
      </section>

      <section>
        <h2>10. Security</h2>
        <p>
          We use appropriate technical and organisational measures to protect
          personal data, including secure hosting and encrypted connections.
        </p>
      </section>

      <section>
        <h2>11. External links</h2>
        <p>
          This website may contain links to third-party websites. We are not
          responsible for their privacy practices.
        </p>
      </section>

      <section>
        <h2>12. Changes to this policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Any changes will
          be posted on this page.
        </p>
      </section>

      <section>
        <h2>13. Contact</h2>
        <p>
          If you have questions about this Privacy Policy or wish to exercise
          your rights, please contact us via the details provided on the website.
        </p>
      </section>
    </article>
  );
}

function SponsoredContent({ brandName }: { brandName: string }) {
  return (
    <article className="prose prose-invert max-w-none">
      <section>
        <h2>1. What sponsored listings are</h2>
        <p>
          Sponsored Listings on {brandName} are paid advertising placements that
          allow businesses to increase their visibility within search results or
          geographic areas.
        </p>
        <p>
          Sponsored Listings are clearly marked and are distinct from organic
          search results.
        </p>
      </section>

      <section>
        <h2>2. No endorsement</h2>
        <p>
          Payment for a Sponsored Listing does not constitute an endorsement,
          recommendation, or verification of the business, its services, or its
          suitability for any purpose.
        </p>
        <p>
          Users are responsible for carrying out their own checks before engaging
          a listed business.
        </p>
      </section>

      <section>
        <h2>3. How sponsored placement works</h2>
        <p>
          Sponsored Listings may appear in prominent positions, including at the
          top of search results or highlighted within specific service areas.
        </p>
        <p>
          Placement is based on the active sponsorship for the selected area and
          category and does not guarantee customer enquiries or work.
        </p>
      </section>

      <section>
        <h2>4. Eligibility and accuracy</h2>
        <p>
          Businesses purchasing Sponsored Listings confirm that:
        </p>
        <ul>
          <li>The information provided is accurate and not misleading</li>
          <li>They are legally entitled to offer the services advertised</li>
          <li>They comply with applicable UK laws and advertising standards</li>
        </ul>
      </section>

      <section>
        <h2>5. Payments and billing</h2>
        <p>
          Fees paid for Sponsored Listings relate solely to advertising services
          provided by {brandName}.
        </p>
        <p>
          Sponsored Listing fees are non-refundable unless otherwise stated or
          required by law.
        </p>
      </section>

      <section>
        <h2>6. Suspension or removal</h2>
        <p>
          {brandName} reserves the right to suspend or remove Sponsored Listings
          where a business breaches these terms, provides misleading information,
          or where required for legal or operational reasons.
        </p>
      </section>

      <section>
        <h2>7. Liability</h2>
        <p>
          {brandName} is not responsible for the performance, conduct, or quality
          of services provided by businesses with Sponsored Listings.
        </p>
      </section>

      <section>
        <h2>8. Changes to sponsored listings</h2>
        <p>
          We may update these Sponsored Listing terms from time to time. Continued
          use of Sponsored Listings constitutes acceptance of the updated terms.
        </p>
      </section>

      <section>
        <h2>9. Contact</h2>
        <p>
          If you have questions about Sponsored Listings, please contact us via
          the details provided on the website.
        </p>
      </section>
    </article>
  );
}
