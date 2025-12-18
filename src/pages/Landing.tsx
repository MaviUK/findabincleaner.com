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

  // keep search point so clicks can be attributed when area_id is missing
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
          {/* ✅ SINGLE hero headline (no duplicate “welcome” badge) */}
          <h1 className="mt-4 text-center font-extrabold tracking-tight">
            <span className="block text-4xl sm:text-5xl text-gray-900">
              Welcome to
            </span>

            <span
              className="
                block
                text-5xl sm:text-7xl
                leading-[1.05]
                font-black
                bg-gradient-to-r from-emerald-600 via-teal-500 to-sky-500
                bg-clip-text text-transparent
                tracking-tight
              "
              style={{
                // Distinctive “brand” feel even before you wire a custom font in
                fontFamily: `"Clash Display", "Inter", system-ui, sans-serif`,
                letterSpacing: "-0.02em",
              }}
            >
              Cleanly
            </span>
          </h1>

          <p className="mt-4 text-base sm:text-lg text-gray-600">
            Pick a service, enter your postcode, and contact trusted local
            cleaners in minutes.
          </p>
        </div>

        {/* Search panel */}
        <div className="mt-7 sm:mt-8 rounded-2xl border border-black/5 bg-white shadow-sm p-4 sm:p-6">
          {/* Service picker */}
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div className="text-left sm:text-left">
              <div className="text-sm font-semibold text-gray-900">Service</div>
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
                      setCleaners(null); // reset results when switching service
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
              onSearchComplete={(results, pc, town, lat, lng) => {
                setCleaners(results || []);
                setPostcode(pc || "");
                setLocality(town || "");
                setSearchLat(typeof lat === "number" ? lat : null);
                setSearchLng(typeof lng === "number" ? lng : null);
              }}
            />
          </div>

          <div className="mt-3 text-xs text-gray-500">
            Free listing for cleaners • No signup fees
          </div>
        </div>

        {/* Results header */}
        {hasResults && (
          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm text-gray-500">Results</div>
              <div className="text-lg font-bold text-gray-900 truncate">
                {cleaners.length}{" "}
                {cleaners.length === 1 ? "business" : "businesses"}{" "}
                {postcode ? `near ${postcode.toUpperCase()}` : "near you"}
                {locality ? ` • ${locality}` : ""}
              </div>
            </div>

            <div className="shrink-0">
              <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-700 px-3 py-1 text-sm">
                {activeService.icon} {activeService.label}
              </span>
            </div>
          </div>
        )}

        {/* Results list */}
        {hasResults && (
          <div className="mt-4">
            <ResultsList
              cleaners={cleaners}
              postcode={postcode}
              locality={locality}
              searchLat={searchLat}
              searchLng={searchLng}
            />
          </div>
        )}
      </section>
    </main>
  );
}
