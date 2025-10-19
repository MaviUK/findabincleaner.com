// src/components/AreaSponsorModal.tsx
import { useEffect, useMemo, useState } from "react";

type Tier = "bronze" | "silver" | "gold";

type PreviewRequest = {
  // Identify selection/source
  cleanerId?: string;
  areaId?: string;
  slot?: 1 | 2 | 3;

  // Pricing inputs
  tier?: Tier;
  geometry?: any; // GeoJSON geometry/feature

  // Optional UI/flow hints
  return_url?: string;
};

type PreviewResponse = {
  ok: boolean;
  message?: string;

  // Pricing data
  km2?: number;
  monthly?: number;
  setup_fee?: number;
  min_monthly?: number;
  currency?: string; // e.g., "GBP"

  // Server-provided preview geometry (e.g., purchasable sub-region)
  // Accept either `available`, `available_gj`, or generic `geometry`
  available?: any;
  available_gj?: any;
  geometry?: any;
};

type CheckoutRequest = {
  cleanerId?: string;
  areaId?: string;
  slot?: 1 | 2 | 3;
  tier?: Tier;
  geometry?: any;
  return_url?: string;
};

type CheckoutResponse = {
  ok: boolean;
  url?: string;
  message?: string;
};

export type AreaSponsorModalProps = {
  open: boolean;
  onClose: () => void;

  // New props coming from ServiceAreaEditor
  cleanerId?: string;
  areaId?: string;
  slot?: 1 | 2 | 3;
  onPreviewGeoJSON?: (multi: any) => void;
  onClearPreview?: () => void;

  // Optional legacy/direct props
  tier?: Tier;       // if omitted, will be derived from slot
  geometry?: any;    // if omitted, server can infer from areaId/cleanerId
};

function slotToTier(slot?: 1 | 2 | 3): Tier | undefined {
  if (slot === 1) return "bronze";
  if (slot === 2) return "silver";
  if (slot === 3) return "gold";
  return undefined;
}

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
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  const resolvedTier: Tier | undefined = tier ?? slotToTier(slot);
  const canInteract = open && !loading && !checkingOut;

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function runPreview() {
      setLoading(true);
      setError(null);
      setPreview(null);

      // Clear any previous overlay when we start fresh
      if (onClearPreview) onClearPreview();

      try {
        const body: PreviewRequest = {
          cleanerId,
          areaId,
          slot,
          tier: resolvedTier,
          geometry, // optional; server can ignore if it derives internally
          // Optional return target if your function uses it
          return_url:
            typeof window !== "undefined"
              ? window.location.origin
              : undefined,
        };

        const res = await fetch("/api/sponsored/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data: PreviewResponse = await res.json();
        if (cancelled) return;

        if (!res.ok || !data.ok) {
          setError(data.message || "Could not calculate preview.");
          return;
        }

        setPreview(data);

        // If server returned purchasable sub-region geometry, push it to the map
        const returnedGeom =
          data.available ?? data.available_gj ?? data.geometry ?? null;
        if (returnedGeom && onPreviewGeoJSON) {
          onPreviewGeoJSON(returnedGeom);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Network error.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    runPreview();

    return () => {
      cancelled = true;
    };
    // Re-run when identifiers or geometry/tier change
  }, [open, cleanerId, areaId, slot, resolvedTier, geometry, onPreviewGeoJSON, onClearPreview]);

  const priceLine = useMemo(() => {
    if (!preview) return "";
    const c = preview.currency || "GBP";
    const monthly =
      typeof preview.monthly === "number"
        ? new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: c,
            maximumFractionDigits: 2,
          }).format(preview.monthly)
        : null;
    const setup =
      typeof preview.setup_fee === "number"
        ? new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: c,
            maximumFractionDigits: 2,
          }).format(preview.setup_fee)
        : null;
    const size =
      typeof preview.km2 === "number"
        ? `${preview.km2.toFixed(2)} km²`
        : undefined;

    return [size && `Area: ${size}`, monthly && `Monthly: ${monthly}`, setup && `Setup: ${setup}`]
      .filter(Boolean)
      .join(" · ");
  }, [preview]);

  function handleClose() {
    if (onClearPreview) onClearPreview();
    onClose();
  }

  async function handleCheckout() {
    setCheckingOut(true);
    setError(null);
    try {
      const body: CheckoutRequest = {
        cleanerId,
        areaId,
        slot,
        tier: resolvedTier,
        geometry,
        return_url:
          typeof window !== "undefined"
            ? window.location.origin
            : undefined,
      };

      const res = await fetch("/api/sponsored/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data: CheckoutResponse = await res.json();

      if (!res.ok || !data.ok || !data.url) {
        setCheckingOut(false);
        setError(data.message || "Checkout could not be created.");
        return;
      }

      // Redirect to Stripe Checkout
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
            Sponsor preview
            {resolvedTier ? ` — ${resolvedTier.toUpperCase()}` : ""}
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

        {loading && (
          <p className="text-sm text-gray-600">Calculating your price…</p>
        )}

        {error && (
          <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && preview && (
          <>
            <p className="mb-2 text-sm text-gray-700">
              We’ve priced your selected area. Review and proceed to checkout.
            </p>
            <div className="mb-4 rounded-lg border border-gray-200 p-3">
              <p className="text-sm">{priceLine}</p>
              {typeof preview.min_monthly === "number" && (
                <p className="mt-1 text-xs text-gray-500">
                  Minimum monthly applies.
                </p>
              )}
            </div>
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
