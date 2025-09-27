// src/pages/Settings.tsx
import React from "react";
import FindCleaners from "../components/FindCleaners";

export default function Settings() {
  return (
    <main className="w-full">
      {/* Hero */}
      <section className="container mx-auto max-w-3xl px-4 py-12">
        <div className="space-y-4">
          <h1 className="text-4xl font-extrabold tracking-tight">
            Book a trusted wheelie bin cleaner in minutes
          </h1>
          <p className="text-gray-600">
            Compare local cleaners, check service areas and book online. Clean bins, happy homes.
          </p>
        </div>

        {/* Postcode search */}
        <div className="mt-6">
          <FindCleaners />
        </div>

        <p className="mt-4 text-sm text-gray-500">
          Free listing for cleaners • No signup fees
        </p>
      </section>

    </main>
  );
}
