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
  let cancelled = false;

  async function run() {
    if (!open) return;

    setErr(null);
    setComputing(true);
    setAreaKm2(null);
    setMonthly(null);

    try {
      const res = await fetch("/.netlify/functions/sponsored-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cleanerId, areaId, slot }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Preview ${res.status} ${txt || ""}`.trim());
      }

      const json: PreviewResp = await res.json();

      if (cancelled) return;

      if (!("ok" in json) || !json.ok) {
        throw new Error((json as PreviewErr)?.error || "Failed to compute preview");
      }

      setAreaKm2(json.area_km2);
      setMonthly(json.monthly_price);

      // hand the overlay to the map (only once)
      if (json.final_geojson && onPreviewGeoJSON) onPreviewGeoJSON(json.final_geojson);
    } catch (e: any) {
      if (!cancelled) setErr(e?.message || "Failed to compute preview");
    } finally {
      if (!cancelled) setComputing(false);
    }
  }

  run();

  return () => {
    cancelled = true;
    // clear preview overlay once when modal closes or deps change
    onClearPreview?.();
  };
  // keep deps minimal so we call exactly once per logical open
}, [open, cleanerId, areaId, slot]);
