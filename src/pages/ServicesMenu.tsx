import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

/**
 * ServicesMenu
 * - Extensible category → variants menu
 * - Starts with category `bin_cleaning` and variants (sizes): 120L, 240L, 360L, 660L, 1100L
 * - Persists selections in `public.service_offerings`
 *
 * Props
 * - cleanerId: the current cleaner's `cleaners.id`
 */
export default function ServicesMenu({ cleanerId }: { cleanerId: string }) {
  // Category scaffolding for future expansion
  const categories = useMemo(
    () => [
      {
        key: "bin_cleaning",
        label: "Bin Cleaning",
        description: "Select the bin sizes you offer.",
        variants: ["120L", "240L", "360L", "660L", "1100L"] as const,
      },
    ],
    []
  );

  type VariantKey = "120L" | "240L" | "360L" | "660L" | "1100L";

  type OfferingState = {
    id?: string;
    active: boolean;
    price_cents?: number | null; // reserved: you can surface pricing later
  };

  const [activeCategory, setActiveCategory] = useState(categories[0].key);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For each variant, keep its local state
  const [variants, setVariants] = useState<Record<VariantKey, OfferingState>>({
    "120L": { active: false },
    "240L": { active: false },
    "360L": { active: false },
    "660L": { active: false },
    "1100L": { active: false },
  });

  // Load from DB on mount / when cleaner changes
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from("service_offerings")
        .select("id, service, variant, is_active, price_cents")
        .eq("cleaner_id", cleanerId)
        .eq("service", "bin_cleaning");

      if (cancelled) return;

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      const next = { ...variants } as Record<VariantKey, OfferingState>;
      (data ?? []).forEach((row) => {
        const v = row.variant as VariantKey;
        if (v in next) {
          next[v] = {
            id: row.id,
            active: !!row.is_active,
            price_cents: row.price_cents ?? null,
          };
        }
      });
      setVariants(next);
      setDirty(false);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanerId]);

  function toggleVariant(v: VariantKey) {
    setVariants((prev) => {
      const next = { ...prev, [v]: { ...prev[v], active: !prev[v].active } };
      return next;
    });
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setError(null);

    // Determine what to upsert and what to delete
    const toUpsert: Array<{ cleaner_id: string; service: string; variant: string; is_active: boolean; price_cents: number | null }>
      = [];
    const toDeleteIds: string[] = [];

    (Object.keys(variants) as VariantKey[]).forEach((k) => {
      const state = variants[k];
      if (state.active) {
        toUpsert.push({
          cleaner_id: cleanerId,
          service: "bin_cleaning",
          variant: k,
          is_active: true,
          price_cents: state.price_cents ?? null,
        });
      } else if (!state.active && state.id) {
        toDeleteIds.push(state.id);
      }
    });

    // Upsert active ones (relies on unique(cleaner_id, service, variant))
    if (toUpsert.length) {
      const { error: upsertErr } = await supabase
        .from("service_offerings")
        .upsert(toUpsert, { onConflict: "cleaner_id,service,variant" });
      if (upsertErr) {
        setError(upsertErr.message);
        setSaving(false);
        return;
      }
    }

    // Delete variants that were previously active but are now off
    if (toDeleteIds.length) {
      const { error: delErr } = await supabase
        .from("service_offerings")
        .delete()
        .in("id", toDeleteIds);
      if (delErr) {
        setError(delErr.message);
        setSaving(false);
        return;
      }
    }

    // Reload to pick up new IDs and clear dirty
    const { data } = await supabase
      .from("service_offerings")
      .select("id, service, variant, is_active, price_cents")
      .eq("cleaner_id", cleanerId)
      .eq("service", "bin_cleaning");

    const refreshed = { ...variants } as Record<VariantKey, OfferingState>;
    (data ?? []).forEach((row) => {
      const v = row.variant as VariantKey;
      if (v in refreshed) {
        refreshed[v] = {
          id: row.id,
          active: !!row.is_active,
          price_cents: row.price_cents ?? null,
        };
      }
    });
    setVariants(refreshed);
    setDirty(false);
    setSaving(false);
  }

  const activeCat = categories.find((c) => c.key === activeCategory)!;

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Services you offer</h1>
        <p className="text-sm text-gray-600">Configure your offerings. You can add more home services later; we start with bin cleaning.</p>
      </div>

      {/* Category selector (single for now, but extensible) */}
      <div className="flex gap-2 mb-4">
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key)}
            className={
              "px-3 py-2 rounded-full border text-sm " +
              (activeCategory === cat.key
                ? "bg-black text-white border-black"
                : "bg-white text-gray-800 border-gray-300 hover:bg-gray-50")
            }
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border p-4 md:p-6 bg-white">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">{activeCat.label}</h2>
          <p className="text-sm text-gray-600">{activeCat.description}</p>
        </div>

        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-10 bg-gray-100 rounded" />
            <div className="h-10 bg-gray-100 rounded" />
            <div className="h-10 bg-gray-100 rounded" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {activeCat.variants.map((v) => {
              const isOn = variants[v].active;
              return (
                <label
                  key={v}
                  className={
                    "flex items-center justify-between gap-3 rounded-xl border p-3 cursor-pointer select-none " +
                    (isOn ? "border-black bg-gray-50" : "border-gray-200 hover:bg-gray-50")
                  }
                >
                  <div>
                    <div className="font-medium">{v}</div>
                    <div className="text-xs text-gray-600">Wheelie bin size</div>
                  </div>

                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={() => toggleVariant(v)}
                    className="h-5 w-5 accent-black"
                  />
                </label>
              );
            })}
          </div>
        )}

        {error && (
          <div className="mt-4 text-sm text-red-600">{error}</div>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={save}
            disabled={!dirty || saving}
            className={
              "px-4 py-2 rounded-lg text-sm font-medium border " +
              (!dirty || saving
                ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                : "bg-black text-white border-black hover:opacity-90")
            }
          >
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
          {dirty && (
            <span className="text-xs text-gray-500">You have unsaved changes</span>
          )}
        </div>
      </div>
    </div>
  );
}
