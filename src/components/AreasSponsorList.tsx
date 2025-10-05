// src/components/AreasSponsorList.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import AreaSponsorDrawer from "./AreaSponsorDrawer";

type AreaRow = {
  id: string;
  name: string;
  // Optional: center/centroid for initial map view
  // If you store it, great. Otherwise we’ll fall back to a default.
  center_lat?: number | null;
  center_lng?: number | null;
};

export default function AreasSponsorList({ cleanerId }: { cleanerId: string }) {
  const [areas, setAreas] = useState<AreaRow[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<{ areaId: string; slot: 1 | 2 | 3; center: [number, number] } | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("service_areas")
        .select("id,name,center_lat,center_lng")
        .eq("cleaner_id", cleanerId)
        .order("name", { ascending: true });
      if (!error && data) {
        setAreas(data as AreaRow[]);
      }
    })();
  }, [cleanerId]);

  function openSponsor(area: AreaRow, slot: 1 | 2 | 3) {
    const center: [number, number] =
      area.center_lat && area.center_lng
        ? [area.center_lat, area.center_lng]
        : [54.66, -5.67]; // fallback (Bangor-ish)
    setActive({ areaId: area.id, slot, center });
    setOpen(true);
  }

  return (
    <>
      <ul className="divide-y rounded-xl border">
        {areas.map((a) => (
          <li key={a.id} className="flex items-center justify-between p-3">
            <div className="font-medium">{a.name}</div>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 rounded border text-sm" onClick={() => openSponsor(a, 1)}>Sponsor #1</button>
              <button className="px-3 py-1.5 rounded border text-sm" onClick={() => openSponsor(a, 2)}>Sponsor #2</button>
              <button className="px-3 py-1.5 rounded border text-sm" onClick={() => openSponsor(a, 3)}>Sponsor #3</button>
            </div>
          </li>
        ))}
        {areas.length === 0 && (
          <li className="p-3 text-sm text-gray-500">No areas yet. Use the map editor above to add one.</li>
        )}
      </ul>

      {open && active && (
        <AreaSponsorDrawer
          open={open}
          onClose={() => setOpen(false)}
          areaId={active.areaId}
          slot={active.slot}
          center={active.center}
        />
      )}
    </>
  );
}
