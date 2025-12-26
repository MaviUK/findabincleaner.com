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
  const [serviceSlug, setServiceSlug] = useState<ServiceSlug>("bin-cleaner");
  const [cleaners, setCleaners] = useState<Cleaner[] | null>(null);
  const [postcode, setPostcode] = useState<string>("");
  const [locality, setLocality] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // ✅ MUST MATCH Layout.tsx rails exactly
  const WRAP = "mx-auto w-full max-w-7xl px-4 sm:px-6";

  const activeService = useMemo(
    () => SERVICE_BUTTONS.find((b) => b.slug === serviceSlug) ?? SERVICE_BUTTONS[0],
    [serviceSlug]
  );

  return (
    <div className="bg-gray-50">
      {/* Outer wrapper that defines the rails */}
      <div className={`${WRAP} py-10 sm:py-14`}>
        {/* Hero */}
        <div className="text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">
            Welcome to
            <span className="block mt-2">
              <span className="text-emerald-700">CLEAN</span>
              <span className="text-sky-600">ly</span>
            </span>
          </h1>
          <p className="mt-4 text-gray-600 max-w-2xl mx-auto">
            Pick a service, enter your postcode, and contact trusted local cleaners in minutes.
          </p>
        </div>

        {/* Search Card */}
        <div className="mt-10 sm:mt-12">
          <div className="bg-white border border-black/5 rounded-2xl shadow-sm p-5 sm:p-6">
            <div className="flex flex-col gap-4">
              {/* Top row: service label + tabs */}
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Service</div>
                  <div className="text-xs text-gray-500">{activeService.blurb}</div>
                </div>

                <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2">
                  {SERVICE_BUTTONS.map((b) => {
                    const active = b.slug === serviceSlug;
                    return (
                      <button
                        key={b.slug}
                        type="button"
                        onClick={() => setServiceSlug(b.slug)}
                        className={[
                          "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition",
                          active
                            ? "bg-emerald-700 text-white border-emerald-700"
                            : "bg-white text-gray-900 border-gray-200 hover:bg-gray-50",
                        ].join(" ")}
                        aria-pressed={active}
                      >
                        <span aria-hidden>{b.icon}</span>
                        {b.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Finder */}
              <FindCleaners
                serviceSlug={serviceSlug}
                onSearchStart={() => {
                  setLoading(true);
                  setCleaners(null);
                }}
                onSearchComplete={(results, pc, loc) => {
                  setLoading(false);
                  setCleaners(results);
                  setPostcode(pc);
                  setLocality(loc ?? "");
                }}
              />

              {/* Small trust row */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-gray-500">
                <div>Free listing for cleaners • No signup fees</div>
                <div className="inline-flex items-center gap-2 justify-center sm:justify-end">
                  <span className="h-2 w-2 rounded-full bg-emerald-600" />
                  Verified businesses only
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="mt-8 sm:mt-10">
          <ResultsList
            cleaners={cleaners}
            loading={loading}
            postcode={postcode}
            locality={locality}
            serviceSlug={serviceSlug}
          />
        </div>
      </div>
    </div>
  );
}
