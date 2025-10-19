// src/components/AreaSponsorModal.tsx
import { useEffect, useMemo, useState } from "react";

type Tier = "bronze" | "silver" | "gold";

type PreviewRequest = {
  tier: Tier;
  // GeoJSON Feature or geometry; keep it "any" to avoid dragging types into the client.
  geometry: any;
};

type PreviewResponse = {
  ok: boolean;
  // Example payload; adapt keys to what your function returns.
  km2?: number;
  monthly?: number;
  setup_fee?: number;
  min_monthly?: number;
  currency?: string; // "GBP"
  message?: string;
};

type CheckoutRequest = {
  tier: Tier;
  geometry: any;
  // optionally include anything else your function expects, e.g. return_url
};

type CheckoutResponse = {
  ok: boolean;
  url?: string;
  message?: string;
};

export type AreaSponsorModalProps = {
  open: boolean;
  onClose: () => void;
  tier: Tier;
  geometry: any; // GeoJSON polygon/multi-polygon being previewed
};

export default function AreaSponsorModal({
  open,
  onClose,
  tier,
  geometry,
}: AreaSponsorModalProps) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  const canInteract = open && !loading && !checkingOut;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      setPreview(null);
      try {
        const res = await fetch("/api/sponsored/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier, geometry } as PreviewRequest),
        });
        const data: PreviewResponse = await res.json();
        if (cancelled) return;

        if (!res.ok || !data.ok) {
          setError(data.message || "Could not calculate preview.");
        } else {
          setPreview(data);
        }
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
  }, [open, tier, geometry]);

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

    const parts = [
      size ? `Area: ${size}` : null,
      monthly ? `Monthly: ${monthly}` : null,
      setup ? `Setup: ${setup}` : null,
    ].filter(Boolean);

    return parts.join(" · ");
  }, [preview]);

  async function handleCheckout() {
    setCheckingOut(true);
    setError(null);
    try {
      const res = await fetch("/api/sponsored/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, geometry } as CheckoutRequest),
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
            Sponsor preview — {tier.toUpperCase()}
          </h2>
          <button
            className="rounded-lg px-3 py-1.5 text-sm hover:bg-gray-100"
            onClick={onClose}
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
            onClick={onClose}
            disabled={!canInteract}
          >
            Cancel
          </button>
          <button
            className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={handleCheckout}
            disabled={!preview || !!error || !open || loading || checkingOut}
          >
            {checkingOut ? "Redirecting…" : "Proceed to Checkout"}
          </button>
        </div>
      </div>
    </div>
  );
}
