// src/components/LegalModal.tsx
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
      <div
        className={classNames(
          "relative mx-auto bg-white shadow-xl",
          // Mobile: full screen sheet
          "h-[100dvh] w-full rounded-none",
          // Desktop: centered modal card
          "sm:mt-10 sm:h-auto sm:max-h-[85vh] sm:w-[min(980px,92vw)] sm:rounded-2xl sm:border sm:border-gray-200"
        )}
        style={{
          // iOS safe areas
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-4 sm:px-6">
          <div>
            <div className="text-lg font-semibold text-gray-900">Legal</div>
            <div className="text-sm text-gray-500">
              {brandName} policies and terms
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            Close
          </button>
        </div>

        {/* Tabs (horizontal scroll on mobile) */}
        <div className="border-b border-gray-200 px-4 py-3 sm:px-6">
          <div className="flex gap-2 overflow-x-auto whitespace-nowrap [-webkit-overflow-scrolling:touch]">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={classNames(
                  "shrink-0 rounded-full px-4 py-2 text-sm font-medium transition",
                  tab === t.key
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content (scroll area) */}
        <main
          className={classNames(
            "px-4 py-5 text-gray-800 sm:px-6 sm:py-6",
            // Mobile: take all remaining space between header and footer
            "overflow-y-auto",
            // If desktop: cap height nicely
            "sm:max-h-[60vh]"
          )}
          style={{
            // Helps mobile keep footer visible while content scrolls
            maxHeight: "calc(100dvh - 64px - 56px - 56px)",
          }}
        >
          {tab === "terms" && <TermsContent brandName={brandName} />}
          {tab === "privacy" && <PrivacyContent brandName={brandName} />}
          {tab === "cookies" && <CookieContent brandName={brandName} />}
          {tab === "sponsored" && <SponsoredContent brandName={brandName} />}
        </main>

        {/* Footer (sticky so button is always reachable) */}
        <div className="sticky bottom-0 border-t border-gray-200 bg-white px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-gray-500">
              Last updated:{" "}
              <span className="text-gray-700">January 25, 2026</span>
            </div>

            <button
              onClick={onClose}
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===================== CONTENT (unchanged) ===================== */

function TermsContent({ brandName }: { brandName: string }) {
  return (
    <article className="prose max-w-none prose-gray">
      {/* your existing TermsContent unchanged */}
      <h2>1. About {brandName}</h2>
      <p>
        {brandName} operates an online directory platform that allows users to
        search for and contact independent bin cleaning businesses operating in
        the United Kingdom.
      </p>
      <p>
        {brandName} does <strong>not</strong> provide bin cleaning services and is
        <strong> not a party</strong> to any agreement, contract, or transaction
        between customers and listed businesses.
      </p>

      <h2>2. Using the website</h2>
      <p>
        You may use this website for lawful purposes only. You agree not to misuse
        the platform, including attempting unauthorised access, scraping data,
        interfering with normal operation, or submitting false or misleading
        information.
      </p>

      <h2>3. Directory listings</h2>
      <p>
        Businesses listed on the site are independent third parties. We do not
        verify, guarantee, or endorse any business, service, pricing, availability,
        or outcome.
      </p>
      <p>
        Any enquiry, quotation, booking, or service arrangement is strictly between
        you and the relevant business.
      </p>

      <h2>4. Sponsored and featured listings</h2>
      <p>
        Some businesses may appear as <strong>Sponsored</strong> or
        <strong> Featured</strong>. These are paid advertising placements.
      </p>
      <p>
        Sponsored placement affects visibility only and does not constitute an
        endorsement, recommendation, or verification by {brandName}.
      </p>

      <h2>5. Enquiries and communications</h2>
      <p>
        When you submit an enquiry through the website, your information is
        forwarded directly to the selected business.
      </p>
      <p>
        We are not responsible for responses, pricing, availability, service
        quality, conduct, or outcomes arising from communications between users
        and businesses.
      </p>

      <h2>6. Business accounts</h2>
      <p>Businesses registering on the platform confirm that:</p>
      <ul>
        <li>All information provided is accurate and kept up to date</li>
        <li>They are legally entitled to provide the advertised services</li>
        <li>They comply with applicable UK laws and regulations</li>
      </ul>
      <p>
        {brandName} reserves the right to suspend or remove listings that breach
        these terms or provide misleading information.
      </p>

      <h2>7. Payments and subscriptions</h2>
      <p>
        Any payments made to {brandName} relate solely to advertising,
        sponsorship, or subscription services.
      </p>
      <p>
        {brandName} does not process or handle payments between customers and
        service providers.
      </p>
      <p>
        Subscription fees are non-refundable unless otherwise stated or required
        by law.
      </p>

      <h2>8. Intellectual property</h2>
      <p>
        All content, branding, logos, and software on this website are owned by
        or licensed to {brandName}. You may not copy, reproduce, or distribute
        content without prior written permission.
      </p>

      <h2>9. Availability and changes</h2>
      <p>
        We aim to keep the website available and accurate but do not guarantee
        uninterrupted or error-free operation.
      </p>
      <p>We may update, suspend, or withdraw any part of the website at any time.</p>

      <h2>10. Liability</h2>
      <p>
        To the maximum extent permitted by law, {brandName} accepts no liability
        for any loss, damage, dispute, or dissatisfaction arising from services
        provided by listed businesses.
      </p>
      <p>
        Nothing in these terms excludes liability where it cannot be excluded
        under UK law.
      </p>

      <h2>11. Indemnity</h2>
      <p>
        You agree to indemnify and hold harmless {brandName} from any claims,
        losses, damages, or expenses arising from your misuse of the website or
        breach of these terms.
      </p>

      <h2>12. Governing law</h2>
      <p>
        These Terms and Conditions are governed by the laws of England and Wales.
        Any disputes are subject to the exclusive jurisdiction of the courts of
        England and Wales.
      </p>

      <h2>13. Contact</h2>
      <p>
        If you have questions about these Terms and Conditions, please contact us
        via the details provided on the website.
      </p>
    </article>
  );
}

function PrivacyContent({ brandName }: { brandName: string }) {
  return (
    <article className="prose max-w-none prose-gray">
      {/* your existing PrivacyContent unchanged */}
      <h2>1. Who we are</h2>
      <p>
        {brandName} operates an online business directory that helps users find
        and contact independent bin cleaning businesses operating in the United
        Kingdom.
      </p>
      <p>
        For the purposes of UK data protection law, {brandName} is the{" "}
        <strong>data controller</strong> of personal data collected through this
        website.
      </p>

      <h2>2. Personal data we collect</h2>

      <h3>Website visitors</h3>
      <ul>
        <li>Postcode or location entered into search</li>
        <li>IP address</li>
        <li>Browser and device information</li>
        <li>Pages viewed and interactions</li>
        <li>Cookie and local storage data</li>
      </ul>

      <h3>Enquiry submissions</h3>
      <ul>
        <li>Name</li>
        <li>Email address</li>
        <li>Telephone number (if provided)</li>
        <li>Message content</li>
        <li>Selected business</li>
      </ul>

      <h3>Registered businesses</h3>
      <ul>
        <li>Business name</li>
        <li>Contact details</li>
        <li>Service categories and coverage areas</li>
        <li>Account login details</li>
        <li>Subscription and billing information</li>
      </ul>

      <h2>3. How we collect data</h2>
      <ul>
        <li>When you search or browse the website</li>
        <li>When you submit an enquiry or contact form</li>
        <li>When a business creates or manages an account</li>
        <li>Automatically via cookies and similar technologies</li>
      </ul>

      <h2>4. How we use your data</h2>
      <ul>
        <li>To operate and maintain the directory</li>
        <li>To display relevant local search results</li>
        <li>To pass enquiries to selected businesses</li>
        <li>To manage business accounts and subscriptions</li>
        <li>To improve website functionality and security</li>
        <li>To prevent fraud, abuse, or misuse</li>
        <li>To comply with legal obligations</li>
      </ul>

      <h2>5. Lawful basis for processing</h2>
      <p>Under UK GDPR, we process personal data on the following lawful bases:</p>
      <ul>
        <li>
          <strong>Legitimate interests</strong> – operating and improving a business
          directory
        </li>
        <li>
          <strong>Consent</strong> – where you voluntarily submit information (such as enquiries)
        </li>
        <li>
          <strong>Contract</strong> – where businesses sign up for paid services
        </li>
        <li>
          <strong>Legal obligation</strong> – where required by law
        </li>
      </ul>

      <h2>6. Sharing your data</h2>
      <p>We share personal data only where necessary to operate the website, including with:</p>
      <ul>
        <li>Website hosting and infrastructure providers</li>
        <li>Email delivery services</li>
        <li>Payment processors (for business subscriptions)</li>
        <li>Analytics and security providers</li>
      </ul>
      <p>We do <strong>not</strong> sell personal data to third parties.</p>

      <h2>7. Enquiries to businesses</h2>
      <p>When you submit an enquiry, your details are sent directly to the selected business.</p>
      <p>
        Once sent, that business becomes independently responsible for how it processes your personal data.
        We encourage you to review their privacy practices.
      </p>

      <h2>8. Cookies</h2>
      <p>
        We use cookies and similar technologies to enable core site functionality,
        maintain login sessions, load maps, and analyse usage where permitted.
      </p>
      <p>More information is available in our Cookie Policy.</p>

      <h2>9. Data retention</h2>
      <p>
        Personal data is retained only for as long as necessary for the purposes described in this policy
        or to meet legal and regulatory requirements.
      </p>

      <h2>10. Your rights</h2>
      <p>Under UK GDPR, you have rights including the right to:</p>
      <ul>
        <li>Access your personal data</li>
        <li>Request correction of inaccurate data</li>
        <li>Request deletion of your data</li>
        <li>Object to or restrict processing</li>
        <li>Request data portability (where applicable)</li>
        <li>Lodge a complaint with the Information Commissioner’s Office (ICO)</li>
      </ul>

      <h2>11. Security</h2>
      <p>
        We use appropriate technical and organisational measures to protect personal data,
        including secure hosting, encryption, and access controls.
      </p>

      <h2>12. External links</h2>
      <p>
        This website may contain links to third-party websites. We are not responsible for the privacy
        practices or content of those sites.
      </p>

      <h2>13. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Any changes will be published on this page
        with an updated revision date.
      </p>

      <h2>14. Contact</h2>
      <p>
        If you have questions about this Privacy Policy or wish to exercise your rights,
        please contact us using the details provided on the website.
      </p>
    </article>
  );
}

function CookieContent({ brandName }: { brandName: string }) {
  return (
    <article className="prose max-w-none prose-gray">
      {/* your existing CookieContent unchanged */}
      <h2>1. What cookies are</h2>
      <p>
        Cookies are small text files placed on your device when you visit a website.
        They help the site function properly, remember preferences, and (where enabled)
        understand how the site is used.
      </p>
      <p>
        Cookies can be “session” cookies (deleted when you close your browser) or
        “persistent” cookies (stored for longer).
      </p>

      <h2>2. How {brandName} uses cookies</h2>
      <p>We use cookies and similar technologies (such as local storage) for:</p>
      <ul>
        <li>Essential website functionality (security and login sessions)</li>
        <li>Remembering preferences (where applicable)</li>
        <li>Loading third-party services such as maps</li>
        <li>
          Analytics (only where enabled and where you have provided consent, if required)
        </li>
      </ul>

      <h2>3. Types of cookies we use</h2>

      <h3>Strictly necessary cookies</h3>
      <p>
        These cookies are required for the website to work and cannot be switched off.
        They are usually set in response to actions you take, such as logging in or submitting forms.
      </p>
      <ul>
        <li>Authentication and session cookies (e.g. Supabase auth session)</li>
        <li>Security cookies (used to prevent abuse and fraud)</li>
        <li>Load-balancing / infrastructure cookies (where required)</li>
      </ul>

      <h3>Functional cookies</h3>
      <p>
        These help us remember choices you make (for example, basic preferences) and provide enhanced features.
      </p>
      <ul>
        <li>Preference storage (e.g. dismissed prompts or selected options)</li>
      </ul>

      <h3>Analytics / performance cookies (optional)</h3>
      <p>
        These cookies help us understand how visitors use the website so we can improve performance and user experience.
        We will only use these where enabled and where consent is required.
      </p>
      <ul>
        <li>Page views, feature usage, and interaction events</li>
        <li>Approximate location derived from IP (not precise GPS)</li>
      </ul>

      <h3>Third-party cookies (e.g. maps)</h3>
      <p>
        Some features on {brandName} rely on third-party services. For example, map and place search features may load
        content from providers such as Google. These providers may set cookies or use similar technologies.
      </p>
      <p>
        We do not control third-party cookies. Their use is governed by the third party’s own policies.
      </p>

      <h2>4. Local storage</h2>
      <p>
        In addition to cookies, we may use local storage in your browser to store certain preferences and session-related
        values to improve usability and maintain stability (for example, remembering UI state).
      </p>

      <h2>5. Managing cookies</h2>
      <p>You can control and delete cookies through your browser settings. You can usually:</p>
      <ul>
        <li>Delete existing cookies</li>
        <li>Block all cookies</li>
        <li>Block third-party cookies</li>
        <li>Set alerts when cookies are being used</li>
      </ul>
      <p>
        If you block strictly necessary cookies, parts of the website may not work (for example, business login and account pages).
      </p>

      <h2>6. Changes to this Cookie Policy</h2>
      <p>
        We may update this Cookie Policy from time to time. Any changes will be published on this page with an updated revision date.
      </p>

      <h2>7. Contact</h2>
      <p>
        If you have questions about cookies or privacy on {brandName}, please contact us using the details provided on the website.
      </p>
    </article>
  );
}

function SponsoredContent({ brandName }: { brandName: string }) {
  return (
    <article className="prose max-w-none prose-gray">
      {/* your existing SponsoredContent unchanged */}
      <h2>1. What Sponsored Listings are</h2>
      <p>
        Sponsored Listings on {brandName} are paid advertising placements that allow businesses to increase their visibility within
        search results, service categories, or defined geographic areas.
      </p>
      <p>
        Sponsored Listings are clearly identified as sponsored or featured and are separate from organic (non-paid) search results.
      </p>

      <h2>2. Advertising only – no endorsement</h2>
      <p>
        Payment for a Sponsored Listing does <strong>not</strong> constitute an endorsement, recommendation, or verification of the business,
        its services, or its suitability for any purpose.
      </p>
      <p>
        {brandName} does not assess the quality of services provided by sponsored businesses. Users are responsible for carrying out their
        own checks before engaging any listed business.
      </p>

      <h2>3. How sponsored placement works</h2>
      <p>Sponsored Listings may appear in prominent positions, including but not limited to:</p>
      <ul>
        <li>At or near the top of search results</li>
        <li>Highlighted within specific service areas</li>
        <li>Featured over non-sponsored listings</li>
      </ul>
      <p>
        Placement is determined by the active sponsorship for a selected area and category and does not guarantee enquiries, bookings,
        or revenue.
      </p>

      <h2>4. Eligibility and accuracy</h2>
      <p>Businesses purchasing Sponsored Listings confirm that:</p>
      <ul>
        <li>The information provided is accurate and not misleading</li>
        <li>They are legally entitled to provide the services advertised</li>
        <li>Their advertising complies with UK law, including consumer protection and advertising standards</li>
      </ul>

      <h2>5. Payments and billing</h2>
      <p>
        Fees paid for Sponsored Listings relate solely to advertising services provided by {brandName}.
      </p>
      <p>Sponsored Listing fees are non-refundable unless otherwise stated or required by law.</p>

      <h2>6. Suspension or removal</h2>
      <p>{brandName} reserves the right to suspend or remove Sponsored Listings without refund where:</p>
      <ul>
        <li>The business breaches these terms</li>
        <li>Information provided is false or misleading</li>
        <li>Required by law or regulatory action</li>
        <li>Necessary to protect users or the integrity of the platform</li>
      </ul>

      <h2>7. Liability</h2>
      <p>
        {brandName} accepts no liability for the performance, conduct, pricing, availability, or quality of services provided by businesses
        with Sponsored Listings.
      </p>

      <h2>8. Changes to Sponsored Listings</h2>
      <p>
        We may update these Sponsored Listing terms from time to time. Continued use of Sponsored Listings constitutes acceptance of the
        updated terms.
      </p>

      <h2>9. Contact</h2>
      <p>
        If you have questions about Sponsored Listings, advertising, or billing, please contact us using the details provided on the website.
      </p>
    </article>
  );
}
