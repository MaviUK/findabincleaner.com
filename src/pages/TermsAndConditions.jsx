import React from "react";

export default function TermsAndConditions() {
  return (
    <main style={ maxWidth: 900, margin: "0 auto", padding: "48px 20px", lineHeight: 1.6 }>
      <header style={ marginBottom: 24 }>
        <h1 style={ fontSize: 40, margin: 0 }>Terms & Conditions</h1>
        <p style={ marginTop: 8, color: "rgba(255,255,255,0.75)" }>
          Last updated: 25 January 2026
        </p>
      </header>

      <article style={ fontSize: 16 }>
        <p style={ margin: "0 0 14px" }>These Terms and Conditions govern the use of this website. By using this site, you agree to these terms.</p>
        <div style={ padding: 14, border: "1px solid rgba(255,255,255,0.15)", borderRadius: 12, margin: "14px 0" }>
                  <p style={ margin: "0 0 14px" }>This website operates as a <strong>business directory only</strong>. We do not provide bin cleaning services.</p>
        </div>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>1. About this website</h2>
        <p style={ margin: "0 0 14px" }>This website provides a directory of bin cleaning businesses operating in the United Kingdom.</p>
        <p style={ margin: "0 0 14px" }>We are not a party to any agreement between customers and listed businesses.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>2. Directory-only role</h2>
        <ul style={ paddingLeft: 20, margin: "0 0 14px" }>
            <li style={ marginBottom: 6 }>We act solely as an information provider.</li>
            <li style={ marginBottom: 6 }>Any service, quotation, agreement, or work carried out is strictly between the customer and the listed business.</li>
            <li style={ marginBottom: 6 }>We do not guarantee the quality, availability, or suitability of any listed business.</li>
        </ul>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>3. Listings and sponsored placements</h2>
        <ul style={ paddingLeft: 20, margin: "0 0 14px" }>
            <li style={ marginBottom: 6 }>Some businesses may appear as <strong>sponsored</strong> or <strong>featured</strong> listings.</li>
            <li style={ marginBottom: 6 }>Sponsored listings are paid advertisements and are clearly labelled.</li>
            <li style={ marginBottom: 6 }>Inclusion or prominence in listings does not constitute endorsement.</li>
        </ul>
        <p style={ margin: "0 0 14px" }>We reserve the right to add, remove, or modify listings at our discretion.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>4. Enquiries and contact forms</h2>
        <ul style={ paddingLeft: 20, margin: "0 0 14px" }>
            <li style={ marginBottom: 6 }>Enquiries submitted through the site are forwarded to the selected business.</li>
            <li style={ marginBottom: 6 }>We are not responsible for responses, pricing, availability, or outcomes of enquiries.</li>
            <li style={ marginBottom: 6 }>Users must not submit false, abusive, or misleading enquiries.</li>
        </ul>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>5. Business accounts</h2>
        <p style={ margin: "0 0 14px" }>Businesses creating accounts confirm that:</p>
        <ul style={ paddingLeft: 20, margin: "0 0 14px" }>
            <li style={ marginBottom: 6 }>Information provided is accurate and kept up to date</li>
            <li style={ marginBottom: 6 }>They have the right to offer the services listed</li>
            <li style={ marginBottom: 6 }>They comply with applicable laws and regulations</li>
        </ul>
        <p style={ margin: "0 0 14px" }>We reserve the right to suspend or remove accounts that breach these terms.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>6. Payments and subscriptions</h2>
        <ul style={ paddingLeft: 20, margin: "0 0 14px" }>
            <li style={ marginBottom: 6 }>Payments are made by businesses only.</li>
            <li style={ marginBottom: 6 }>Subscription fees relate to advertising and listing services.</li>
            <li style={ marginBottom: 6 }>Fees are non-refundable unless stated otherwise.</li>
            <li style={ marginBottom: 6 }>Subscription terms, renewal, and cancellation are displayed at the point of purchase.</li>
        </ul>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>7. Liability</h2>
        <p style={ margin: "0 0 14px" }>To the maximum extent permitted by law:</p>
        <ul style={ paddingLeft: 20, margin: "0 0 14px" }>
            <li style={ marginBottom: 6 }>We accept no liability for services provided by listed businesses.</li>
            <li style={ marginBottom: 6 }>We are not responsible for loss, damage, or disputes arising from use of listed services.</li>
            <li style={ marginBottom: 6 }>We do not guarantee uninterrupted or error-free operation of the website.</li>
        </ul>
        <p style={ margin: "0 0 14px" }>Nothing in these terms limits liability where it cannot be excluded under UK law.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>8. Intellectual property</h2>
        <p style={ margin: "0 0 14px" }>All website content, branding, and design are owned by us unless stated otherwise. You may not copy or reuse content without permission.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>9. Data protection</h2>
        <p style={ margin: "0 0 14px" }>Use of this website is also governed by our <a href="/privacy-policy">Privacy Policy</a>.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>10. Changes to these terms</h2>
        <p style={ margin: "0 0 14px" }>We may update these Terms and Conditions at any time. Continued use of the site constitutes acceptance of the updated terms.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>11. Governing law</h2>
        <p style={ margin: "0 0 14px" }>These terms are governed by the laws of England and Wales. Any disputes are subject to the exclusive jurisdiction of UK courts.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>12. Contact</h2>
        <p style={ margin: "0 0 14px" }>For questions regarding these Terms and Conditions, contact <a href="mailto:hello@yourdomain.co.uk">hello@yourdomain.co.uk</a>.</p>
      </article>
    </main>
  );
}
