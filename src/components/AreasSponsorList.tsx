// src/components/AreasSponsorList.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import AreaSponsorDrawer from "./AreaSponsorDrawer";

type AreaRow = {
  id: string;
  name: string;
  center_lat?: number | null;
  center_lng?: number | null;
};

// Sponsorship state (must match the Netlify function output)
type SlotState = {
  slot: 1 | 2 | 3;
  taken: boolean;
  status: string | null;
  owner_business_id: string | null;
};
type SponsorshipState = {
  area_id: string;
  slots: SlotState[];
  paint: { tier: 0 | 1 | 2 | 3; fill: string; stroke: string };
};

export default function AreasSponsorList({
  cleanerId,
  sponsorshipVersion = 0,
}: {
  cleanerId: string;
  sponsorshipVersion?: number;
}) {
  const [areas, setAreas] = useState<AreaRow[]>([]);
  const [sponsorship, setSponsorship] = useState<Record<string, SponsorshipState | undefined>>({});
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<{ areaId: string; slot: 1 | 2 | 3; center: [number, number] } | null>(null);

  // Load areas
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

  // Load sponsorship state for these areas (refetch when version bumps)
  useEffect(() => {
    (async () => {
      const areaIds = areas.map((a) => a.id);
      if (!areaIds.length) return;
      try {
        const res = await fetch("/.netlify/functions/area-sponsorship", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ areaIds }),
        });
        if (!res.ok) throw new Error(`sponsorship ${res.status}`);
        const json: { areas: SponsorshipState[] } = await res.json();
        const map: Record<string, SponsorshipState | undefined> = {};
        for (const s of json.areas) map[s.area_id] = s;
        setSponsorship(map);
      } catch (e) {
        console.warn("[AreasSponsorList] area-sponsorship fetch failed:", e);
        setSponsorship({});
      }
    })();
  }, [areas, sponsorshipVersion]);

  function slotInfo(areaId: string, slot: 1 | 2 | 3) {
    return sponsorship[areaId]?.slots.find((x) => x.slot === slot);
  }

  function openSponsor(area: AreaRow, slot: 1 | 2 | 3) {
    const s = slotInfo(area.id, slot);
    const mine = !!s?.owner_business_id && s.owner_business_id === cleanerId;
    const disabled = !!s?.taken && !mine;
    if (disabled) return;

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
        {areas.map((a) => {
          const s1 = slotInfo(a.id, 1);
          const s2 = slotInfo(a.id, 2);
          const s3 = slotInfo(a.id, 3);

          const mine1 = !!s1?.owner_business_id && s1.owner_business_id === cleanerId;
          const mine2 = !!s2?.owner_business_id && s2.owner_business_id === cleanerId;
          const mine3 = !!s3?.owner_business_id && s3.owner_business_id === cleanerId;

          const dis1 = !!s1?.taken && !mine1;
          const dis2 = !!s2?.taken && !mine2;
          const dis3 = !!s3?.taken && !mine3;

          return (
            <li key={a.id} className="flex items-center justify-between p-3">
              <div className="font-medium">{a.name}</div>
              <div className="flex gap-2">
                <button
                  className={`px-3 py-1.5 rounded border text-sm ${dis1 ? "opacity-50 cursor-not-allowed" : ""}`}
                  onClick={() => openSponsor(a, 1)}
                  disabled={dis1}
                  title={s1?.taken ? `Status: ${s1?.status || "taken"}` : "Available"}
                >
                  {s1?.taken ? (mine1 ? "Manage #1" : "Taken #1") : "Sponsor #1"}
                </button>
                <button
                  className={`px-3 py-1.5 rounded border text-sm ${dis2 ? "opacity-50 cursor-not-allowed" : ""}`}
                  onClick={() => openSponsor(a, 2)}
                  disabled={dis2}
                  title={s2?.taken ? `Status: ${s2?.status || "taken"}` : "Available"}
                >
                  {s2?.taken ? (mine2 ? "Manage #2" : "Taken #2") : "Sponsor #2"}
                </button>
                <button
                  className={`px-3 py-1.5 rounded border text-sm ${dis3 ? "opacity-50 cursor-not-allowed" : ""}`}
                  onClick={() => openSponsor(a, 3)}
                  disabled={dis3}
                  title={s3?.taken ? `Status: ${s3?.status || "taken"}` : "Available"}
                >
                  {s3?.taken ? (mine3 ? "Manage #3" : "Taken #3") : "Sponsor #3"}
                </button>
              </div>
            </li>
          );
        })}
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
