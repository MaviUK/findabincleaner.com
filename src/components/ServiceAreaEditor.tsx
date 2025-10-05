import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import AreaSponsorDrawer from "./AreaSponsorDrawer";

type ServiceArea = {
  id: string;
  name: string | null;
  // If you later add centroid fields, you can include them here:
  // centroid_lat?: number | null;
  // centroid_lng?: number | null;
};

export default function ServiceAreaEditor({ cleanerId }: { cleanerId: string }) {
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Sponsor drawer state
  const [sponsorOpen, setSponsorOpen] = useState(false);
  const [sponsorAreaId, setSponsorAreaId] = useState<string | null>(null);
  const [sponsorSlot, setSponsorSlot] = useState<1 | 2 | 3>(1);
  const [sponsorCenter, setSponsorCenter] = useState<[number, number]>([54.664, -5.67]); // fallback

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // Fetch the areas for this cleaner
        const { data, error } = await supabase
          .from("service_areas")
          .select("id,name")
          .eq("cleaner_id", cleanerId)
          .order("created_at", { ascending: true });

        if (error) throw error;
        if (!mounted) return;
        setAreas((data || []) as ServiceArea[]);
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message || "Failed to load service areas");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [cleanerId]);

  function openSponsor(a: ServiceArea, slot: 1 | 2 | 3) {
    // If you later store centroids, set them here:
    // const center: [number, number] = a.centroid_lat && a.centroid_lng
    //   ? [a.centroid_lat, a.centroid_lng]
    //   : [54.664, -5.67];
    const center: [number, number] = [54.664, -5.67];

    setSponsorAreaId(a.id);
    setSponsorSlot(slot);
    setSponsorCenter(center);
    setSponsorOpen(true);
  }

  if (loading) {
    return <div className="p-4 text-sm text-gray-600">Loading areas…</div>;
  }
  if (err) {
    return <div className="p-4 text-sm text-red-600">{err}</div>;
  }

  return (
    <div className="divide-y">
      {areas.length === 0 && (
        <div className="p-4 text-sm text-gray-600">No service areas yet.</div>
      )}

      {areas.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <div className="font-medium truncate">{a.name || "Unnamed area"}</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="px-2 py-1 text-xs rounded border"
              onClick={() => openSponsor(a, 1)}
              title="Sponsor spot #1 for this area"
            >
              Sponsor #1
            </button>
            <button
              className="px-2 py-1 text-xs rounded border"
              onClick={() => openSponsor(a, 2)}
              title="Sponsor spot #2 for this area"
            >
              Sponsor #2
            </button>
            <button
              className="px-2 py-1 text-xs rounded border"
              onClick={() => openSponsor(a, 3)}
              title="Sponsor spot #3 for this area"
            >
              Sponsor #3
            </button>
          </div>
        </div>
      ))}

      {sponsorOpen && sponsorAreaId && (
        <AreaSponsorDrawer
          open={sponsorOpen}
          onClose={() => setSponsorOpen(false)}
          areaId={sponsorAreaId}
          slot={sponsorSlot}
          center={sponsorCenter}
        />
      )}
    </div>
  );
}
