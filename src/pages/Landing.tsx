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
  accent: string; // tailwind classes
}[] = [
  {
    slug: "bin-cleaner",
    label: "Bin Cleaner",
    icon: "🗑️",
    blurb: "Wheelie bins, deep clean & deodorise",
    accent: "from-emerald-500 to-teal-500",
  },
  {
    slug: "window-cleaner",
    label: "Window Cleaner",
    icon: "🪟",
    blurb: "Windows, frames, sills",
    accent: "from-sky-500 to-indigo-500",
  },
  {
    slug: "cleaner",
    label: "General Cleaner",
    icon: "🧼",
    blurb: "General domestic cleaning",
    accent: "from-fuchsia-500 to-rose-500",
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
    () => SERVICE_BUTTONS.find((s) => s.slug === serviceSlug) ?? SERVICE_BUTTONS[0],
    [serviceSlug]
  );

  const hasResults = Array.isArray(cleaners);

  return (
    <main className="w-full">
      {/* Vibrant background */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 -left-24 h-80 w-80 rounded-full bg-emerald-300/35 blur-3xl" />
          <div className="absolute top-16 -right-20 h-96 w-96 rounded-full bg-sky-300/35 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-fuchsia-300/25 blur-3xl" />
        </div>

        <section className="container mx-auto max-w-5xl px-4 py-10 sm:py-12 relative">
          {/* Hero */}
          <div className="text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/70 backdrop-blur border border-black/5 px-3 py-1 text-xs font-semibold text-gray-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Welcome to
              <span className="font-extrabold text-gray-900">
                Clean<span className="text-emerald-600">.</span>ly
              </span>
            </div>

            <h1 className="mt-4 text-4xl sm:text-6xl font-extrabold tracking-tight text-gray-900">
              <span className="block">Welcome to the</span>
              <span className="block">
                <span className="bg-gradient-to-r from-gray-900 via-emerald-700 to-sky-700 bg-clip-text text-transparent">
                  Cleanly
                </span>
              </span>
            </h1>

            <p className="text-gray-700 mt-3 text-base sm:text-lg">
              Pick a service, enter your postcode, and contact local businesses in minutes.
            </p>
          </div>

          {/* Search panel */}
          <div className="mt-7 sm:mt-10 rounded-3xl border border-black/5 bg-white/80 backdrop-blur shadow-sm p-4 sm:p-6">
            {/* Service picker */}
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900">Service</div>

                <div className="mt-2 flex items-center gap-3">
                  <span
                    className={[
                      "inline-flex items-center justify-center h-10 w-10 rounded-2xl text-lg",
                      "bg-gradient-to-br",
                      activeService.accent,
                      "text-white shadow-sm",
                    ].join(" ")}
                    aria-hidden
                  >
                    {activeService.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="text-base font-bold text-gray-900 truncate">
                      {activeService.label}
                    </div>
                    <div className="text-xs text-gray-600 truncate">{activeService.blurb}</div>
                  </div>
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
                        setCleaners(null);
                      }}
                      className={[
                        "relative px-4 py-2 rounded-2xl border text-sm font-semibold transition",
                        "focus:outline-none focus:ring-2 focus:ring-emerald-500/40",
                        active
                          ? "text-white border-transparent shadow-sm"
                          : "bg-white text-gray-900 border-gray-200 hover:border-gray-300",
                      ].join(" ")}
                    >
                      {active && (
                        <span
                          className={[
                            "absolute inset-0 rounded-2xl -z-10 bg-gradient-to-r",
                            b.accent,
                          ].join(" ")}
                        />
                      )}
                      <span className="mr-2">{b.icon}</span>
                      {b.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Postcode search */}
            <div className="mt-5">
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

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
              <span>Free listing for cleaners • No signup fees</span>
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Verified businesses only
              </span>
            </div>
          </div>

          {/* Results header */}
          {hasResults && (
            <div className="mt-7 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-gray-600">Results</div>
                <div className="text-lg sm:text-xl font-extrabold text-gray-900 truncate">
                  {cleaners.length} {cleaners.length === 1 ? "business" : "businesses"}{" "}
                  {postcode ? `near ${postcode.toUpperCase()}` : "near you"}
                  {locality ? ` • ${locality}` : ""}
                </div>
              </div>

              <div className="shrink-0">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/70 backdrop-blur border border-black/5 text-gray-800 px-3 py-1.5 text-sm font-semibold">
                  <span
                    className={[
                      "h-7 w-7 rounded-full grid place-items-center text-sm text-white",
                      "bg-gradient-to-br",
                      activeService.accent,
                    ].join(" ")}
                    aria-hidden
                  >
                    {activeService.icon}
                  </span>
                  {activeService.label}
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
      </div>
    </main>
  );
}
