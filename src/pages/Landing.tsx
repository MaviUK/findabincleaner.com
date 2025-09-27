// src/pages/Landing.tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import FindCleaners from "../components/FindCleaners";
import ResultsList from "../components/ResultsList";

type Cleaner = any; // use your real type if you have one

export default function Landing() {
  const [cleaners, setCleaners] = useState<Cleaner[] | null>(null);
  const [postcode, setPostcode] = useState<string>("");

  return (
    <main className="w-full">
      <section className="container mx-auto max-w-3xl px-4 py-12">
        <div className="space-y-4">
          <h1 className="text-4xl font-extrabold tracking-tight">
            Book a trusted wheelie bin cleaner in minutes
          </h1>
          <p className="text-gray-600">
            Compare local cleaners, check service areas and book online. Clean bins, happy homes.
          </p>

          {/* CTA buttons (router-safe) */}
          <div className="flex gap-3">
            <Link to="/login" className="bg-emerald-700 text-white px-4 py-2 rounded">
              I’m a cleaner
            </Link>
            <a href="#find" className="border px-4 py-2 rounded">
              Find cleaners
            </a>
          </div>
        </div>

        {/* Search */}
        <div id="find" className="mt-6">
          <FindCleaners
            onSearchComplete={(results: Cleaner[], pc: string) => {
              setCleaners(results || []);
              setPostcode(pc || "");
            }}
          />
        </div>

        {/* Results */}
        {Array.isArray(cleaners) && (
          <div className="mt-6">
            <ResultsList cleaners={cleaners} postcode={postcode} />
          </div>
        )}

        <p className="mt-4 text-sm text-gray-500">
          Free listing for cleaners • No signup fees
        </p>
      </section>
    </main>
  );
}
