// inside AreaSponsorModal.tsx

type PreviewOk = {
  ok: true;
  area_km2: number;
  monthly_price: number;
  final_geojson: any | null;
};
type PreviewErr = { ok?: false; error?: string };
type PreviewResp = PreviewOk | PreviewErr;

useEffect(() => {
  if (!open) return;

  let cancelled = false;
  const controller = new AbortController();

  // clear any previous overlay right away so the user
  // doesn’t see a stale highlight while we recompute
  onClearPreview?.();

  async function run() {
    setErr(null);
    setComputing(true);
    setAreaKm2(null);
    setMonthly(null);

    try {
      const res = await fetch("/.netlify/functions/sponsored-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cleanerId, areaId, slot }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Preview ${res.status} ${txt || ""}`.trim());
      }

      const json: PreviewResp = await res.json();
      if (cancelled || controller.signal.aborted) return;

      if (!("ok" in json) || !json.ok) {
        throw new Error((json as PreviewErr)?.error || "Failed to compute preview");
      }

      setAreaKm2(json.area_km2);
      setMonthly(json.monthly_price);

      if (json.final_geojson && onPreviewGeoJSON) {
        onPreviewGeoJSON(json.final_geojson);
      }
    } catch (e: any) {
      if (!cancelled && !controller.signal.aborted) {
        setErr(e?.message || "Failed to compute preview");
      }
    } finally {
      if (!cancelled && !controller.signal.aborted) {
        setComputing(false);
      }
    }
  }

  run();

  return () => {
    cancelled = true;
    controller.abort();
    onClearPreview?.();
  };
// Intentionally keep deps minimal so it runs once per open
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [open, cleanerId, areaId, slot]);
