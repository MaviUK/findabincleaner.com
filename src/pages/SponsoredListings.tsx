import React from "react";

export default function SponsoredListings() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <article className="prose prose-invert max-w-none">
        <h1>Sponsored Listings</h1>
        <p>
          Some results may appear as sponsored placements. Sponsored placements are paid promotions
          and may be displayed based on location and category.
        </p>

        <h2>How sponsorship works</h2>
        <ul>
          <li>Sponsored placements are labeled as sponsored.</li>
          <li>Availability may vary by area and category.</li>
          <li>We do not guarantee results or performance for sponsors.</li>
        </ul>

        <h2>Contact</h2>
        <p>
          If you have questions about sponsored listings, contact us via the details on our site.
        </p>
      </article>
    </main>
  );
}
