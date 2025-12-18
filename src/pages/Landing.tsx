// src/pages/Landing.tsx
import { useState } from "react";
import FindCleaners, { type ServiceSlug } from "../components/FindCleaners";
import ResultsList from "../components/ResultsList";

type Cleaner = any;

const SERVICE_BUTTONS: { slug: ServiceSlug; label: string }[] = [
  { slug: "bin-cleaner", label: "🗑️ Bin Cleaner" },
  { slug: "window-cleaner", label: "🪟 Window Cleaner" },
  { slug: "cleaner", label: "🧼 General Cleaner" },
];

export default function Landing() {
  const [cleaners, setCleaners] = useState<Cleaner[] | null>(null);
  const [postcode, setPostcode] = useState<string>("");
  const [locality, setLocality] = useState<string>("");

  const [serviceSlug, setServiceSlug] = useState<ServiceSlug>("bin-cleaner");

  // keep search point so clicks can be attributed when area_id is missing
  const [searchLat, setSearchLat] = useState<number | null>(null);
  const [searchLng, setSearchLng] = useState<number | null>(null);

  return (
    <main className="w-full">
      <section className="container mx-auto max-w-5xl px-4 py-12">
        <div className="space-y-3 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight">
            Find a trusted local cleaner
          </h1>
          <p className="text-gray-600">
            Choose a service, then enter your postcode to see local businesses.
          </p>
        </div>

        {/* Service buttons (NO dropdown, NO "search all") */}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
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
                  "px-4 py-2 rounded border text-sm font-medium",
                  active
                    ? "bg-emerald-700 text-white border-emerald-700"
                    : "bg-white text-gray-900 border-gray-200 hover:border-gray-300",
                ].join(" ")}
              >
                {b.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="mt-6">
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

        {Array.isArray(cleaners) && (
          <div className="mt-6">
            <ResultsList
              cleaners={cleaners}
              postcode={postcode}
              locality={locality}
              searchLat={searchLat}
              searchLng={searchLng}
            />
          </div>
        )}

        <p className="mt-4 text-sm text-gray-500 text-center">
          Free listing for cleaners • No signup fees
        </p>
      </section>
    </main>
  );
}
