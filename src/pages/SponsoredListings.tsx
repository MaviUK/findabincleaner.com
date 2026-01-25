import React from "react";

export default function SponsoredListingsDisclosure() {
  return (
    <main style={{
      maxWidth: 900,
      margin: "0 auto",
      padding: "48px 20px",
      lineHeight: 1.6,
      color: "#111827"
    }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 40, margin: 0 }}>Sponsored Listings</h1>
        <p style={{ marginTop: 8, color: "#6B7280" }}>
          Last updated: 25 January 2026
        </p>
      </header>

      <article style={{ fontSize: 16 }}>
        <p style={ margin: "0 0 14px" }>This page explains how sponsored listings work on this business directory.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>1. Sponsored listings</h2>
        <p style={ margin: "0 0 14px" }>Some businesses may appear as <strong>Sponsored</strong> or <strong>Featured</strong>. These placements are paid advertisements.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>2. How sponsored placement affects results</h2>
        <p style={ margin: "0 0 14px" }>Sponsored businesses may be displayed more prominently in certain areas or positions. Where this happens, the listing will be clearly labelled as sponsored.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>3. No endorsement</h2>
        <p style={ margin: "0 0 14px" }>Sponsored placement does not mean we recommend or endorse a business. We operate as a directory only and do not verify service quality.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>4. Questions</h2>
        <p style={ margin: "0 0 14px" }>If you have questions about sponsored listings, contact <a href="mailto:hello@yourdomain.co.uk">hello@yourdomain.co.uk</a>.</p>
      </article>
    </main>
  );
}
