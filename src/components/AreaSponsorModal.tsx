open: boolean;
onClose: () => void;

  // business/area
  businessId: string;
  areaId: string;
  areaName?: string;
  businessId: string;         // cleaner/business id
  areaId: string;             // service area id

  // total area of this service area in km² – computed in the editor and passed in
  totalKm2: number;

  // preview overlay hooks from the editor
  // Map overlay callbacks from the editor
onPreviewGeoJSON?: (multi: any) => void;
onClearPreview?: () => void;

  // Total area of the selected service area (km²) – computed by the caller
  totalKm2?: number;
};

// Format helpers
const fmtKm2 = (n: number | null | undefined) =>
  Number.isFinite(n as number) ? (n as number).toFixed(4) : "—";
const fmtMoney = (n: number | null | undefined) =>
  Number.isFinite(n as number) ? `£${(n as number).toFixed(2)}` : "—";
type PreviewResponse = {
  ok: boolean;
  error?: string;
  geojson?: any;
  area_km2?: number; // available km² for purchase (this slot)
  // Optional pricing fields supplied by the function (if configured server-side)
  unit_price?: number;            // price per km² per month, in major units (e.g., 99.99)
  unit_currency?: string;         // e.g. "GBP"
  min_monthly?: number;           // minimum monthly price, major units
  monthly_price?: number;         // server-computed monthly price (major units)
  // Backward-compat: support pence forms if your function returns them
  unit_price_pence?: number;      // integer pence
  min_monthly_pence?: number;     // integer pence
  monthly_price_pence?: number;   // integer pence
};

function formatMoney(amountMajor?: number | null, currency = "GBP") {
  if (amountMajor == null || !isFinite(amountMajor)) return "—";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountMajor);
  } catch {
    return `£${amountMajor.toFixed(2)}`;
  }
}

function clamp2(n: number) {
  return Math.max(0, Math.round(n * 100) / 100);
}

export default function AreaSponsorModal({
open,
onClose,
businessId,
areaId,
  areaName,
  totalKm2,
onPreviewGeoJSON,
onClearPreview,
  totalKm2,
}: Props) {
const [loading, setLoading] = useState(false);
  const [rateLoading, setRateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // preview result from server (what’s still purchasable)
const [availableKm2, setAvailableKm2] = useState<number | null>(null);
  const [ratePerKm2, setRatePerKm2] = useState<number | null>(null);
  const [currency, setCurrency] = useState<string>("GBP");

  const monthly = useMemo(() => {
    if (!Number.isFinite(availableKm2 as number) || !Number.isFinite(ratePerKm2 as number))
      return null;
    return (availableKm2 as number) * (ratePerKm2 as number);
  }, [availableKm2, ratePerKm2]);
  // Pricing (major units)
  const [unitPrice, setUnitPrice] = useState<number | null>(null);     // per km² per month
  const [minMonthly, setMinMonthly] = useState<number | null>(null);   // minimum monthly
  const [serverMonthly, setServerMonthly] = useState<number | null>(null); // if server sent monthly

  // Derived monthly cost if server did not provide
  const computedMonthly = useMemo(() => {
    if (serverMonthly != null) return clamp2(serverMonthly);
    if (availableKm2 == null || unitPrice == null) return null;
    const raw = availableKm2 * unitPrice;
    const minApplied = minMonthly != null ? Math.max(minMonthly, raw) : raw;
    return clamp2(minApplied);
  }, [availableKm2, unitPrice, minMonthly, serverMonthly]);

  // kick off preview (geometry intersection & area that’s still free)
useEffect(() => {
if (!open) return;
let cancelled = false;

    async function run() {
    async function loadPreview() {
setLoading(true);
      setError(null);
      setErr(null);
try {
const res = await fetch("/.netlify/functions/sponsored-preview", {
method: "POST",
headers: { "content-type": "application/json" },
body: JSON.stringify({
businessId,
            cleanerId: businessId,
            cleanerId: businessId, // same id in your schema
areaId,
            slot: 1, // single featured slot
            slot: 1, // single-slot model
}),
});

if (!res.ok) {
          setError(`Preview ${res.status}`);
          return;
          throw new Error(`Preview failed (${res.status})`);
}

        const json = await res.json();
        if (!json?.ok) {
          setError(json?.error || "Preview failed");
          return;
        const data: PreviewResponse = await res.json();
        if (!data?.ok) {
          throw new Error(data?.error || "Preview not available");
}

        const km2 = Number(json.area_km2 ?? 0);
        setAvailableKm2(Number.isFinite(km2) ? km2 : 0);
        if (cancelled) return;

        // draw purchasable sub-region on the map
        if (!cancelled && json.geojson && onPreviewGeoJSON) {
          onPreviewGeoJSON(json.geojson);
        }
      } catch (e: any) {
        setError(e?.message || "Preview error");
      } finally {
        setLoading(false);
      }
    }
        // overlay
        if (data.geojson && onPreviewGeoJSON) onPreviewGeoJSON(data.geojson);

    run();
    return () => {
      cancelled = true;
      onClearPreview?.();
    };
  }, [open, businessId, areaId, onPreviewGeoJSON, onClearPreview]);
        // available km² (from server)
        const avail = typeof data.area_km2 === "number" ? Math.max(0, data.area_km2) : 0;
        setAvailableKm2(avail);

  // fetch price per km²/month from your Netlify function (env-backed)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
        // currency
        setCurrency(data.unit_currency || "GBP");

    async function loadRate() {
      setRateLoading(true);
      try {
        const res = await fetch("/.netlify/functions/area-rate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slot: 1 }), // reuse slot=1 as "Featured"
        });
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;
        // pricing
        // Prefer server-provided major-unit fields. Fall back to pence if supplied.
        const unit =
          (typeof data.unit_price === "number" ? data.unit_price : null) ??
          (typeof data.unit_price_pence === "number" ? data.unit_price_pence / 100 : null);

        const minm =
          (typeof data.min_monthly === "number" ? data.min_monthly : null) ??
          (typeof data.min_monthly_pence === "number" ? data.min_monthly_pence / 100 : null);

        // Accept either {rate} or {gold,silver,bronze}
        const rate =
          typeof j?.rate === "number"
            ? j.rate
            : typeof j?.gold === "number"
            ? j.gold
            : null;
        const monthly =
          (typeof data.monthly_price === "number" ? data.monthly_price : null) ??
          (typeof data.monthly_price_pence === "number" ? data.monthly_price_pence / 100 : null);

        setRatePerKm2(rate);
        setUnitPrice(unit);
        setMinMonthly(minm);
        setServerMonthly(monthly);
      } catch (e: any) {
        if (!cancelled) {
          setErr(e?.message || "Failed to load preview");
          setAvailableKm2(null);
          setUnitPrice(null);
          setMinMonthly(null);
          setServerMonthly(null);
          if (onClearPreview) onClearPreview();
        }
} finally {
        setRateLoading(false);
        if (!cancelled) setLoading(false);
}
}
    loadRate();

    loadPreview();
return () => {
cancelled = true;
};
  }, [open]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, businessId, areaId]);

  function close() {
    if (onClearPreview) onClearPreview();
    onClose();
  }

async function startCheckout() {
    setCheckingOut(true);
    setErr(null);
try {
      setError(null);
const res = await fetch("/.netlify/functions/sponsored-checkout", {
method: "POST",
headers: { "content-type": "application/json" },
body: JSON.stringify({
businessId,
          cleanerId: businessId,
areaId,
          slot: 1,
          // Send the server the specific purchasable area we previewed,
          // so it can price consistently.
          preview_km2: availableKm2,
          slot: 1, // single-slot world
}),
});
      const j = await res.json();
      if (j?.url) {
        window.location.href = j.url;
      } else {
        setError(j?.error || "Could not start checkout.");
      }
      const data = await res.json();
      if (!res.ok || !data?.url) throw new Error(data?.error || "Could not start checkout");
      window.location.href = data.url; // redirect to Stripe
} catch (e: any) {
      setError(e?.message || "Could not start checkout.");
      setErr(e?.message || "Checkout failed");
      setCheckingOut(false);
}
}

if (!open) return null;

  const coveragePct =
    Number.isFinite(availableKm2 as number) && Number.isFinite(totalKm2)
      ? Math.max(0, Math.min(100, ((availableKm2 as number) / (totalKm2 || 1)) * 100))
      : null;
  const total = totalKm2 ?? null;
  const avail = availableKm2;

return (
    <div className="fixed inset-0 z-[99999] grid place-items-center bg-black/30 p-4">
      <div className="w-full max-w-xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold">Sponsor — Featured</div>
          <button className="text-sm opacity-70 hover:opacity-100" onClick={onClose}>
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl ring-1 ring-black/5 overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-lg">Sponsor this Area</h3>
          <button className="text-sm opacity-70 hover:opacity-100" onClick={close}>
Close
</button>
</div>

        <div className="px-4 py-4 space-y-3">
          <div className="rounded-md border text-xs px-3 py-2 bg-emerald-50 border-emerald-200 text-emerald-800">
            Preview shows only the purchasable sub-region on the map.
          </div>

          <div className="text-sm font-medium">Monthly price</div>
          <div className="text-xs text-gray-600">
            Rate: {rateLoading ? "…" : fmtMoney(ratePerKm2)} / km² / month
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
        <div className="px-5 py-4 space-y-4">
          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {err}
</div>
)}

          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <div className="text-gray-500">Available area</div>
              <div className="font-medium">{loading ? "…" : `${fmtKm2(availableKm2)} km²`}</div>
            </div>
            <div>
              <div className="text-gray-500">Total area</div>
              <div className="font-medium">{`${fmtKm2(totalKm2)} km²`}</div>
            </div>
          </div>

          <div className="text-xs text-gray-600">
            Coverage:{" "}
            {coveragePct == null ? "—" : `${coveragePct.toFixed(1)}% of your total polygon`}
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Total area" value={total != null ? `${total.toFixed(3)} km²` : "—"} />
            <Stat
              label="Available area"
              value={
                loading
                  ? "Loading…"
                  : avail != null
                  ? `${avail.toFixed(3)} km²`
                  : "—"
              }
            />
            <Stat
              label="Price per km² / month"
              value={unitPrice != null ? formatMoney(unitPrice, currency) : "—"}
              hint="From server env"
            />
            <Stat
              label="Minimum monthly"
              value={minMonthly != null ? formatMoney(minMonthly, currency) : "—"}
              hint="Floor price"
            />
            <Stat
              label="Your monthly price"
              value={
                loading
                  ? "Loading…"
                  : computedMonthly != null
                  ? formatMoney(computedMonthly, currency)
                  : "—"
              }
              emphasis
            />
</div>

          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 text-sm pt-2">
            <div className="text-gray-500">Area:</div>
            <div className="font-medium">{fmtKm2(availableKm2)} km²</div>
            <div className="text-gray-500">Monthly: <span className="font-semibold">{fmtMoney(monthly)}</span></div>
          </div>
          <p className="text-xs text-gray-500">
            The map highlights the purchasable sub-area (if any). Your listing will be featured in
            this coverage.
          </p>
</div>

        <div className="flex items-center justify-between px-4 py-3 border-t">
          <button className="btn" onClick={onClose}>
        <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
          <button className="btn" onClick={close} disabled={loading || checkingOut}>
Cancel
</button>
<button
className="btn btn-primary"
onClick={startCheckout}
            disabled={!availableKm2 || !ratePerKm2}
            disabled={loading || checkingOut || !avail || avail <= 0}
            title={!avail || avail <= 0 ? "No purchasable area available" : "Proceed to checkout"}
>
            Continue to checkout
            {checkingOut ? "Redirecting…" : "Buy now"}
</button>
</div>
</div>
</div>
);
}

function Stat({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={"mt-1 " + (emphasis ? "text-xl font-semibold" : "text-base font-medium")}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-gray-400 mt-1">{hint}</div>}
    </div>
  );
}
