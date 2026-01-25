// src/pages/Landing.tsx
import { useEffect, useMemo, useState } from "react";
import FindCleaners, { type ServiceSlug } from "../components/FindCleaners";
import ResultsList from "../components/ResultsList";
import { supabase } from "../lib/supabase";

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
    icon: "/icons/bin-cleaner.png",
    blurb: "Wheelie bins, deep clean & deodorise",
  },
  {
    slug: "window-cleaner",
    label: "Window Cleaner",
    icon: "/icons/window-cleaner.png",
    blurb: "Windows, frames, sills",
  },
  {
    slug: "cleaner",
    label: "Domestic Cleaner",
    icon: "/icons/general-cleaner.png",
    blurb: "Domestic cleaning",
  },
];

type ServiceCategory = {
  id: string;
  slug: string;
  name: string;
};

export default function Landing() {
  const [cleaners, setCleaners] = useState<Cleaner[] | null>(null);
  const [postcode, setPostcode] = useState<string>("");
  const [locality, setLocality] = useState<string>("");

  const [serviceSlug, setServiceSlug] = useState<ServiceSlug>("bin-cleaner");

  const [searchLat, setSearchLat] = useState<number | null>(null);
  const [searchLng, setSearchLng] = useState<number | null>(null);

  // ✅ NEW: categories lookup so we can log category_id correctly
  const [serviceCategories, setServiceCategories] = useState<ServiceCategory[]>(
    []
  );

  // ✅ NEW: current search “context” ids passed down for analytics attribution
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("service_categories")
        .select("id, slug, name")
        .order("name", { ascending: true });

      if (cancelled) return;
      if (error) {
        console.warn("Failed to load service_categories:", error);
        setServiceCategories([]);
        return;
      }

      setServiceCategories((data as any[]) || []);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // map current slug -> category id
  const categoryIdForSlug = useMemo(() => {
    const hit = serviceCategories.find((c) => c.slug === serviceSlug);
    return hit?.id ?? null;
  }, [serviceCategories, serviceSlug]);

  // keep activeCategoryId in sync with the selected service
  useEffect(() => {
    setActiveCategoryId(categoryIdForSlug);
  }, [categoryIdForSlug]);

  const activeService = useMemo(
    () =>
      SERVICE_BUTTONS.find((s) => s.slug === serviceSlug) ?? SERVICE_BUTTONS[0],
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
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-cyan-300 via-emerald-400 to-yellow-300 bg-[length:200%_200%] animate-klean-gradient">
              Klean.ly
            </span>
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
                        setCleaners(null);
                        setActiveAreaId(null); // reset area context
                        // category context updated by effect above
                      }}
                      className={[
                        "px-4 py-2 rounded-xl border text-sm font-semibold transition",
                        "focus:outline-none focus:ring-2 focus:ring-emerald-500/40",
                        "flex items-center justify-center gap-2", // ✅ icon+label layout
                        active
                          ? "bg-emerald-700 text-white border-emerald-700 shadow-sm"
                          : "bg-white text-gray-900 border-gray-200 hover:border-gray-300",
                      ].join(" ")}
                    >
                      {/* ✅ render image icon instead of printing the string */}
                      <img
                        src={b.icon}
                        alt=""
                        className="h-5 w-5 shrink-0"
                        aria-hidden="true"
                      />
                      <span>{b.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Postcode search */}
            <div className="mt-4">
              <FindCleaners
                serviceSlug={serviceSlug}
                onSearchStart={() => {
                  setCleaners(null);
                  setActiveAreaId(null);
                }}
                onSearchComplete={(results, pc, town, lat, lng) => {
                  const next = results || [];
                  setCleaners(next);

                  setPostcode(pc || "");
                  setLocality(town || "");

                  setSearchLat(typeof lat === "number" ? lat : null);
                  setSearchLng(typeof lng === "number" ? lng : null);

                  // ✅ Set active area from the results (first result’s area_id)
                  // This is used so "Stats by Area" + click attribution has an area_id to group against.
                  const firstAreaId = (next?.[0] as any)?.area_id ?? null;
                  setActiveAreaId(firstAreaId);
                }}
              />
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
              <span>Free listing for cleaners</span>
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Kleanly your Home Service Search
              </span>
            </div>
          </div>

          {/* Results */}
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
                  <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-100 px-3 py-1 text-sm">
                    {/* ✅ render image icon here too */}
                    <img
                      src={activeService.icon}
                      alt=""
                      className="h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span>{activeService.label}</span>
                  </span>
                </div>
              </div>

              <div className="mt-4">
                <ResultsList
                  cleaners={cleaners}
                  postcode={postcode}
                  locality={locality}
                  // ✅ crucial: ensures clicks log with correct ids
                  categoryId={activeCategoryId}
                  areaId={activeAreaId}
                />
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
