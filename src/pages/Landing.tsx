// src/pages/Landing.tsx
import React from "react";
import FindCleaners from "../components/FindCleaners";

export default function Landing() {
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

          {/* CTA buttons under heading (matches your screenshot) */}
          <div className="flex gap-3">
            <a
              href="#/login"
              className="bg-emerald-700 text-white px-4 py-2 rounded"
            >
              I’m a cleaner
            </a>
            <a
              href="#/"
              className="border px-4 py-2 rounded"
            >
              Find cleaners
            </a>
          </div>
        </div>

        {/* Postcode search widget */}
        <div className="mt-6">
          <FindCleaners />
        </div>

        <p className="mt-4 text-sm text-gray-500">
          Free listing for cleaners • No signup fees
        </p>
      </section>

      {/* Footer */}
      <footer className="border-t">
        <div className="container mx-auto px-4 py-6 flex items-center justify-between text-sm text-gray-500">
          <span>© {new Date().getFullYear()} Find a Bin Cleaner</span>
          <span>
            Built with <span className="text-rose-600">❤</span>
          </span>
        </div>
      </footer>
    </main>
  );
}
