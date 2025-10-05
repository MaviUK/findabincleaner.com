// In src/components/ServiceAreaEditor.tsx (or wherever you list areas)
import { useState } from "react";
import AreaSponsorDrawer from "./AreaSponsorDrawer";

// …inside your component…
const [sponsorOpen, setSponsorOpen] = useState(false);
const [sponsorAreaId, setSponsorAreaId] = useState<string | null>(null);
const [sponsorSlot, setSponsorSlot] = useState<1 | 2 | 3>(1);
const [sponsorCenter, setSponsorCenter] = useState<[number, number]>([54.66, -5.67]); // default if your area lacks centroid

// when rendering each area row:
{areas.map((a) => {
  // If you store centroids or can compute them client-side, set them here
  const center: [number, number] = a.centroid_lat && a.centroid_lng ? [a.centroid_lat, a.centroid_lng] : sponsorCenter;

  return (
    <div key={a.id} className="flex items-center justify-between gap-2 py-2">
      <div className="truncate">{a.name}</div>
      <div className="flex items-center gap-2">
        <button
          className="px-2 py-1 text-xs rounded border"
          onClick={() => {
            setSponsorAreaId(a.id);
            setSponsorSlot(1);
            setSponsorCenter(center);
            setSponsorOpen(true);
          }}
        >
          Sponsor #1
        </button>
        <button
          className="px-2 py-1 text-xs rounded border"
          onClick={() => {
            setSponsorAreaId(a.id);
            setSponsorSlot(2);
            setSponsorCenter(center);
            setSponsorOpen(true);
          }}
        >
          Sponsor #2
        </button>
        <button
          className="px-2 py-1 text-xs rounded border"
          onClick={() => {
            setSponsorAreaId(a.id);
            setSponsorSlot(3);
            setSponsorCenter(center);
            setSponsorOpen(true);
          }}
        >
          Sponsor #3
        </button>
      </div>
    </div>
  );
})}

{/* Drawer */}
{ sponsorOpen && sponsorAreaId && (
  <AreaSponsorDrawer
    open={sponsorOpen}
    onClose={() => setSponsorOpen(false)}
    areaId={sponsorAreaId}
    slot={sponsorSlot}
    center={sponsorCenter}
  />
)}
