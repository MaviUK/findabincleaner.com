// src/pages/Landing.tsx
import { useMemo, useState } from "react";
import FindCleaners, { type ServiceSlug } from "../components/FindCleaners";
import ResultsList from "../components/ResultsList";

type Cleaner = any;

const SERVICE_BUTTONS: {
  slug: ServiceSlug;
  label: string;
  icon: string;
  blurb: string;
}[] = [
  {
    slug: "bin-cleaner",
    label: "Bin Cleaner",
    icon: "🗑️",
    blurb: "Wheelie bins, deep clean & deodorise",
  },
  {
    slug: "window-cleaner",
    label: "Window Cleaner",
    icon: "🪟",
    blurb: "Windows, frames, sills",
  },
  {
    slug: "cleaner",
    label: "General Cleaner",
    icon: "🧼",
    blurb: "General domestic cleaning",
  },
];

export default function Landing() {
  const [cleaners, setCleaners] = useState<Cleaner[] | null>(null);
  const [postcode, setPostcode] = useState<string>("");
  const [locality, setLocality] = useState<string>("");

  const [serviceSlug, setServiceSlug] = useState<ServiceSlug>("bin-cleaner");

  const [searchLat, setSearchLat] = useState<number | null>(null);
  const [searchLng, setSearchLng] = useState<number | null>(null);

  const activeService = useMemo(
    () =>
      SERVICE_BUTTONS.find((s) => s.slug === serviceSlug) ??
      SERVICE_BUTTONS[0],
    [serviceSlug]
  );

  const hasResults = Array.isArray(cleaners);

  return (
    <main className="w-full">
      <section className="container mx-auto max-w-5xl px-4 py-10 sm:py-12">
        {/* Hero */}
        <div className="text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
            Welcome to
          </h1>
          <div className="mt-2 text-5xl sm:text-6xl font-extrabold tracking-tight">
            <span className="text-emerald-700">CLEAN</span>
            <span className="text-sky-600 font-normal normal-case">ly</span>
          </div>

          <p className="text-gray-600 mt-4 max-w-2xl mx-auto">
            Pick a service, enter your postcode, and contact trusted local
            cleaners in minutes.
          </p>
        </div>

        {/* ✅ Shared width wrapper so Search + Results align */}
        <div className="mt-7 sm:mt-8 w-full max-w-5xl mx-auto">
          {/* Search panel */}
          <div className="rounded-2xl border border-black/5 bg-white shadow-sm p-4 sm:p-6">
            {/* Service picker */}
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">
                  Service
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {activeService.blurb}
                </div>
              </div>

              <div className="inline-flex flex-wrap justify-center sm:justify-end gap-2">
                {SERVICE_BUTTONS.map((b) => {
                  const active = b.slug === serviceSlug;
                  return (
                    <button
                      key={b.slug}
                      type="button"
                      onClick={() => {
                        setServiceSlug(b.slug);
                        setCleaners(null); // clear results when switching service
                      }}
                      className={[
                        "px-4 py-2 rounded-xl border text-sm font-semibold transition",
                        "focus:outline-none focus:ring-2 focus:ring-emerald-500/40",
                        active
                          ? "bg-emerald-700 text-white border-emerald-700 shadow-sm"
                          : "bg-white text-gray-900 border-gray-200 hover:border-gray-300",
                      ].join(" ")}
                    >
                      <span className="mr-2">{b.icon}</span>
                      {b.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Postcode search */}
            <div className="mt-4">
              <FindCleaners
                serviceSlug={serviceSlug}
                onSearchStart={() => setCleaners(null)} // ✅ clears old results on new search
                onSearchComplete={(results, pc, town, lat, lng) => {
                  setCleaners(results || []);
                  setPostcode(pc || "");
                  setLocality(town || "");
                  setSearchLat(typeof lat === "number" ? lat : null);
                  setSearchLng(typeof lng === "number" ? lng : null);
                }}
              />
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
              <span>Free listing for cleaners • No signup fees</span>
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Verified businesses only
              </span>
            </div>
          </div>

          {/* Results (✅ same width + alignment as search) */}
          {hasResults && (
            <div className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs tracking-widest text-gray-500">
                    RESULTS
                  </div>
                  <div className="text-lg font-bold text-gray-900 truncate">
                    {cleaners.length}{" "}
                    {cleaners.length === 1 ? "business" : "businesses"}{" "}
                    {postcode ? `near ${postcode.toUpperCase()}` : "near you"}
                    {locality ? ` • ${locality}` : ""}
                  </div>
                </div>

                <div className="shrink-0">
                  <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-800 border border-emerald-100 px-3 py-1 text-sm">
                    {activeService.icon} {activeService.label}
                  </span>
                </div>
              </div>

              <div className="mt-4">
                <ResultsList
  cleaners={cleaners}
  postcode={postcode}
  locality={locality}
/>

              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
