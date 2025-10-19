import { useEffect, useMemo, useState } from "react";

type Tier = "bronze" | "silver" | "gold";

type AreaSponsorModalProps = {
  open: boolean;
  onClose: () => void;

  // identifiers from ServiceAreaEditor
  cleanerId?: string;
  areaId?: string;
  slot?: 1 | 2 | 3;

  // map overlay hooks
  onPreviewGeoJSON?: (multi: any) => void;
  onClearPreview?: () => void;

  // optional direct inputs
  tier?: Tier;
  geometry?: any; // GeoJSON (Feature/Geometry/MultiPolygon)
};

function slotToTier(slot?: 1 | 2 | 3): Tier | undefined {
  return slot === 1 ? "bronze" : slot === 2 ? "silver" : slot === 3 ? "gold" : undefined;
}

// defensive helpers — tolerate many shapes
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

export default function AreaSponsorModal(props: AreaSponsorModalProps) {
  const {
    open,
    onClose,
    cleanerId,
    areaId,
    slot,
    onPreviewGeoJSON,
    onClearPreview,
    tier,
    geometry,
  } = props;

  const [loading, setLoading] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<any | null>(null);

  const resolvedTier = tier ?? slotToTier(slot);
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

      // Send all aliases so the function doesn’t care which one it reads
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

        // geometry aliases (server can pick one)
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
    const monthly = pickNumber(preview, "monthly");
    const setup = pickNumber(preview, "setup_fee");
    const km2 = pickNumber(preview, "km2");
    const minMonthly = pickNumber(preview, "min_monthly");

    const nf = (n?:
