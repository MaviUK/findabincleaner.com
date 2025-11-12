// src/components/AreaSponsorModal.tsx
import React, { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  businessId: string;
  areaId: string;
  areaName: string;
  onPreviewGeoJSON: (multi: any) => void;
  onClearPreview: () => void;
};

type PreviewResponse = {
  ok: boolean;
  error?: string;
  totalKm2?: number;
  availableKm2?: number;
  coveragePct?: number;
  pricePerKm2Pennies?: number;
  minMonthlyPennies?: number;
  monthlyPricePennies?: number;
  soldOut?: boolean;
  reason?: string | null;
  gj?: any;
};

const SLOT_DEFAULT = 1;

function formatKm2(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(3)} km²`;
}

function formatCurrencyFromPennies(
  pennies: number | null | undefined,
  currencySymbol = "£"
): string {
  if (pennies == null || !Number.isFinite(pennies)) return `${currencySymbol}0.00`;
  return `${currencySymbol}${(pennies / 100).toFixed(2)}`;
}

export const AreaSponsorModal: React.FC<Props> = ({
  open,
  onClose,
  businessId,
  areaId,
  areaName,
  onPreviewGeoJSON,
  onClearPreview,
}) => {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [totalKm2, setTotalKm2] = useState<number | null>(null);
  const [availableKm2, setAvailableKm2] = useState<number | null>(null);
  const [coveragePct, setCoveragePct] = useState<number | null>(null);

  const [pricePerKm2Pennies, setPricePerKm2Pennies] = useState<number | null>(
    null
  );
  const [minMonthlyPennies, setMinMonthlyPennies] = useState<number | null>(
    null
  );
  const [monthlyPricePennies, setMonthlyPricePennies] = useState<number | null>(
    null
  );

  const [soldOut, setSoldOut] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  const [serverError, setServerError] = useState<string | null>(null);

  // Reset state when the modal closes
  useEffect(() => {
    if (!open) {
      setServerError(null);
      setBusy(false);
      setLoading(false);
      setSoldOut(false);
      setReason(null);
      setTotalKm2(null);
      setAvailableKm2(null);
      setCoveragePct(null);
      setPricePerKm2Pennies(null);
      setMinMonthlyPennies(null);
      setMonthlyPricePennies(null);
      onClearPreview();
    }
  }, [open, onClearPreview]);

  // Load preview when opening
  useEffect(() => {
    if (!open || !areaId) return;
    void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, areaId, businessId]);

  const showSoldOutBanner = useMemo(() => {
    if (soldOut) return true;
    if (availableKm2 != null && availableKm2 <= 0) return true;
    return false;
  }, [soldOut, availableKm2]);

  const canBuy = useMemo(() => {
    if (!businessId || !areaId) return false;
    if (showSoldOutBanner) return false;
    if (loading || busy) return false;
    return true;
  }, [businessId, areaId, showSoldOutBanner, loading, busy]);

  async function loadPreview() {
    setLoading(true);
    setServerError(null);

    try {
      const body = {
        areaId,
        slot: SLOT_DEFAULT,
      };

      const res = await fetch("/api/sponsored/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = (await res.json()) as PreviewResponse;

      if (!res.ok || !json.ok) {
        setServerError(json.error || "Failed to load sponsorship preview");
        setTotalKm2(null);
        setAvailableKm2(null);
        setCoveragePct(null);
        setSoldOut(true);
        setReason(json.reason || "preview_failed");
        onClearPreview();
        return;
      }

      const tKm2 =
        json.totalKm2 != null ? Number(json.totalKm2) : (null as number | null);
      const aKm2 =
        json.availableKm2 != null
          ? Math.max(0, Number(json.availableKm2))
          : (null as number | null);

      setTotalKm2(tKm2);
      setAvailableKm2(aKm2);
      setCoveragePct(
        json.coveragePct != null ? Number(json.coveragePct) : null
      );
      setPricePerKm2Pennies(
        json.pricePerKm2Pennies != null
          ? Number(json.pricePerKm2Pennies)
          : null
      );
      setMinMonthlyPennies(
        json.minMonthlyPennies != null ? Number(json.minMonthlyPennies) : null
      );
      setMonthlyPricePennies(
        json.monthlyPricePennies != null
          ? Number(json.monthlyPricePennies)
          : null
      );

      const computedSoldOut =
        Boolean(json.soldOut) || (aKm2 != null && aKm2 <= 0);
      setSoldOut(computedSoldOut);
      setReason(json.reason ?? null);

      if (json.gj) {
        onPreviewGeoJSON(json.gj);
      } else {
        onClearPreview();
      }
    } catch (err: any) {
      console.error("Error loading sponsored preview", err);
      setServerError(err.message || "Failed to load sponsorship preview");
      setSoldOut(true);
      setReason("preview_error");
      setTotalKm2(null);
      setAvailableKm2(null);
      setCoveragePct(null);
      onClearPreview();
    } finally {
      setLoading(false);
    }
  }

  async function handleBuyNow() {
    if (!canBuy) return;

    setBusy(true);
    setServerError(null);

    try {
      const res = await fetch("/api/sponsored/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          areaId,
          slot: SLOT_DEFAULT,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        // If conflict, refresh preview so UI reflects latest state
        if (res.status === 409) {
          await loadPreview();
        }
        setServerError(json.error || "Checkout failed");
        return;
      }

      const url = json.url || json.checkoutUrl;
      if (url) {
        window.location.href = url;
      } else {
        setServerError(
          "Checkout created but no redirect URL was returned from the server."
        );
      }
    } catch (err: any) {
      console.error("Error starting checkout", err);
      setServerError(err.message || "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const pricePerKm2Label = formatCurrencyFromPennies(pricePerKm2Pennies);
  const minMonthlyLabel = formatCurrencyFromPennies(minMonthlyPennies);
  const monthlyPriceLabel = formatCurrencyFromPennies(monthlyPricePennies);
  const coverageLabel =
    coveragePct != null && Number.isFinite(coveragePct)
      ? `${coveragePct.toFixed(1)}% of your polygon`
      : "100.0% of your polygon";

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <header className="modal-header">
          <h2>Sponsor — {areaName}</h2>
          <button type="button" className="close-button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="modal-body">
          <div className="alert alert-success">
            Featured sponsorship makes you first in local search results.
            Preview highlights the purchasable sub-region.
          </div>

          {showSoldOutBanner && (
            <div className="alert alert-error">
              No purchasable area left for this slot.
              {reason && reason !== "ok" ? ` (${reason})` : ""}
            </div>
          )}

          {serverError && (
            <div className="alert alert-error">{serverError}</div>
          )}

          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="card">
              <div className="card-label">Total area</div>
              <div className="card-value">{formatKm2(totalKm2)}</div>
            </div>

            <div className="card">
              <div className="card-label">Available area</div>
              <div className="card-value">{formatKm2(availableKm2)}</div>
            </div>

            <div className="card">
              <div className="card-label">Price per km² / month</div>
              <div className="card-value">
                {pricePerKm2Pennies == null ? "Loading…" : pricePerKm2Label}
              </div>
              <div className="card-subtext">From server</div>
            </div>

            <div className="card">
              <div className="card-label">Minimum monthly</div>
              <div className="card-value">
                {minMonthlyPennies == null ? "Loading…" : minMonthlyLabel}
              </div>
              <div className="card-subtext">Floor price</div>
            </div>

            <div className="card">
              <div className="card-label">Your monthly price</div>
              <div className="card-value">
                {monthlyPricePennies == null ? "£0.00" : monthlyPriceLabel}
              </div>
            </div>

            <div className="card">
              <div className="card-label">Coverage</div>
              <div className="card-value">{coverageLabel}</div>
            </div>
          </div>
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!canBuy}
            onClick={handleBuyNow}
            title={
              canBuy ? "" : "No purchasable area available or still loading"
            }
          >
            {busy ? "Starting checkout…" : "Buy now"}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default AreaSponsorModal;
