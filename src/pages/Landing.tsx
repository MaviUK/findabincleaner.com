// src/pages/Landing.tsx
import { useState } from "react";
import FindCleaners from "../components/FindCleaners";
import ResultsList from "../components/ResultsList";

type Cleaner = any;
type ServiceSlug = "bin-cleaner" | "window-cleaner" | "cleaner" | null;

export default function Landing() {
  const [service, setService] = useState<ServiceSlug>(null);

  const [cleaners, setCleaners] = useState<Cleaner[] | null>(null);
  const [postcode, setPostcode] = useState<string>("");
  const [locality, setLocality] = useState<string>("");

  const [searchLat, setSearchLat] = useState<number | null>(null);
  const [searchLng, setSearchLng] = useState<number | null>(null);

  return (
    <main className="w-full">
      <section className="container mx-auto max-w-5xl px-4 py-14">
        {/* HERO */}
        <div className="space-y-4 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight">
            Find a trusted local cleaner
          </h1>

          <p className="text-gray-600 max-w-2xl mx-auto">
            Choose a service and enter your postcode to see verified local businesses.
          </p>
        </div>

        {/* SERVICE BUTTONS */}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => setService("bin-cleaner")}
            className={`px-5 py-3 rounded-lg border font-medium ${
              service === "bin-cleaner"
                ? "bg-emerald-700 text-white border-emerald-700"
                : "bg-white hover:bg-gray-50"
            }`}
          >
            🗑️ Bin Cleaner
          </button>

          <button
            onClick={() => setService("window-cleaner")}
            className={`px-5 py-3 rounded-lg border font-medium ${
              service === "window-cleaner"
                ? "bg-emerald-700 text-white border-emerald-700"
                : "bg-white hover:bg-gray-50"
            }`}
          >
            🪟 Window Cleaner
          </button>

          <button
            onClick={() => setService("cleaner")}
            className={`px-5 py-3 rounded-lg border font-medium ${
              service === "cleaner"
                ? "bg-emerald-700 text-white border-emerald-700"
                : "bg-white hover:bg-gray-50"
            }`}
          >
            🧼 General Cleaner
          </button>
        </div>

        {/* SEARCH */}
        {service && (
          <div className="mt-10">
            <FindCleaners
              serviceSlug={service}
              onSearchComplete={(results, pc, town, lat, lng) => {
                setCleaners(results || []);
                setPostcode(pc || "");
                setLocality(town || "");
                setSearchLat(typeof lat === "number" ? lat : null);
                setSearchLng(typeof lng === "number" ? lng : null);
              }}
            />
          </div>
        )}

        {/* RESULTS */}
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

        {!service && (
          <p className="mt-10 text-center text-sm text-gray-500">
            Select a service above to get started
          </p>
        )}
      </section>
    </main>
  );
}
