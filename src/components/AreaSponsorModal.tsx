// src/components/AreaSponsorModal.tsx
import { useEffect, useMemo, useState } from "react";

type Tier = "bronze" | "silver" | "gold";

export type AreaSponsorModalProps = {
  open: boolean;
  onClose: () => void;

  // From ServiceAreaEditor
  cleanerId?: string;
  areaId?: string;
  slot?: 1 | 2 | 3;

  // Map overlay hooks
  onPreviewGeoJSON?: (multi: any) => void;
  onClearPreview?: () => void;

  // Optional direct inputs
  tier?: Tier;
  geometry?: any; // GeoJSON (Feature/Geometry)
};

function slotToTier(slot?: 1 | 2 | 3): Tier | undefined {
  return slot === 1 ? "bronze" : slot === 2 ? "silver" : slot === 3 ? "gold" : undefined;
}

// ---- Robust pickers: tolerate multiple response shapes
function pickCurrency(x: any): string {
  return x?.currency || x?.price?.currency || x?.quote?.currency || "GBP";
}
function pickNumber(x: any, key: string): number | undefined {
  if (typeof x?.[key] === "number") return x[key];
  if (typeof x?.price?.[key] === "number") return x.price[key];
  if (typeof x?.quote?.[key] === "number") return x.quote[key];
  if (typeof x?.data?.[key] === "number") return x.data[key];
  return undefined;
}
function pickPreviewGeom(x: any): any {
  return (
    x?.available ??
    x?.available_gj ??
    x?.available_geojson ??
    x?.geometry ??
    x?.geojson ??
    x?.multi ??
    null
  );
}
// -----------------------------------------------

export default function AreaSponsorModal({
  open,
  onClose,
  cleanerId,
  areaId,
  slot,
  onPreviewGeoJSON,
  onClearPreview,
  tier,
  geometry,
}: AreaSponsorModalProps) {
  const [loading, setLoading] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<any | null>(null);

  const resolvedTier: Tier | undefined = tier ?? slotToTier(slot);
  const canInteract = open && !loading && !checkingOut;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      setPreview(null);
      onClearPreview?.();

      const return_url =
        typeof window !== "undefined" ? window.location.origin : undefined;

      // Send all common aliases so the function doesn't care which one it reads
      const body = {
        // identifiers
        cleanerId,
        cleaner_id: cleanerId,
        areaId,
        service_area_id: areaId,

        // plan / tier
        slot,
        plan: slot,
        tier: resolvedTier,
        sponsorship_level: resolvedTier,

        // geometry aliases
        geometry,
        geojson: geometry,
        multi: geometry,
        polygon: geometry,
        polygons: geometry,

        return_url,
      };

      try {
        const res = await fetch("/api/sponsored/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();

        if (cancelled) return;

        if (!res.ok || data?.ok === false) {
          setError(data?.message || "Could not calculate preview.");
          return;
        }

        setPreview(data);

        const clip = pickPreviewGeom(data);
        if (clip && onPreviewGeoJSON) onPreviewGeoJSON(clip);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Network error.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [open, cleanerId, areaId, slot, resolvedTier, geometry, onPreviewGeoJSON, onClearPreview]);

  const priceLine = useMemo(() => {
    if (!preview) return "";
    const currency = pickCurrency(preview);
    const fmt = (n?: number) =>
      typeof n === "number"
        ? new Intl.NumberFormat(undefined, {
            style: "currency",
            currency,
            maximumFractionDigits: 2,
          }).format(n)
        : undefined;

    const monthly = fmt(pickNumber(preview, "monthly"));
    const setup = fmt(pickNumber(preview, "setup_fee"));
    const km2Num = pickNumber(preview, "km2");
    const minMonthly = fmt(pickNumber(preview, "min_monthly"));

    const parts: string[] = [];
    if (typeof km2Num === "number") parts.push(`Area: ${km2Num.toFixed(2)} km²`);
    if (monthly) parts.push(`Monthly: ${monthly}`);
    if (setup) parts.push(`Setup: ${setup}`);
    if (minMonthly) parts.push(`Minimum monthly applies (${minMonthly}).`);

    return parts.join(" · ");
  }, [preview]);

  function handleClose() {
    onClearPreview?.();
    onClose();
  }

  async function handleCheckout() {
    setCheckingOut(true);
    setError(null);

    const return_url =
      typeof window !== "undefined" ? window.location.origin : undefined;

    const body = {
      cleanerId,
      cleaner_id: cleanerId,
      areaId,
      service_area_id: areaId,
      slot,
      plan: slot,
      tier: resolvedTier,
      sponsorship_level: resolvedTier,
      geometry,
      geojson: geometry,
      multi: geometry,
      polygon: geometry,
      polygons: geometry,
      return_url,
    };

    try {
      const res = await fetch("/api/sponsored/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; url?: string; message?: string };

      if (!res.ok || data?.ok === false || !data?.url) {
        setCheckingOut(false);
        setError(data?.message || "Checkout could not be created.");
        return;
      }

      window.location.assign(data.url);
    } catch (e: any) {
      setCheckingOut(false);
      setError(e?.message ?? "Network error during checkout.");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Sponsored Area Preview"
    >
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-xl font-bold">
            Sponsor preview{resolvedTier ? ` — ${resolvedTier.toUpperCase()}` : ""}
          </h2>
          <button
            className="rounded-lg px-3 py-1.5 text-sm hover:bg-gray-100"
            onClick={handleClose}
            disabled={!canInteract}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading && <p className="text-sm text-gray-600">Calculating your price…</p>}

        {error && (
          <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {!loading && !error && preview && (
          <>
            <p className="mb-2 text-sm text-gray-700">
              We’ve priced your selected area. Review and proceed to checkout.
            </p>
            <input
              type="text"
              className="mb-4 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              readOnly
              value={priceLine}
              aria-label="Price summary"
            />
          </>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
            onClick={handleClose}
            disabled={!canInteract}
          >
            Cancel
          </button>
          <button
            className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={handleCheckout}
            disabled={!!error || !open || loading || checkingOut}
          >
            {checkingOut ? "Redirecting…" : "Proceed to Checkout"}
          </button>
        </div>
      </div>
    </div>
  );
}
