import React, { useEffect, useMemo, useState } from "react";
import AreaSponsorModal from "./AreaSponsorModal";
import ManageSponsorModal from "./ManageSponsorModal";

type Slot = 1;

type ServiceArea = {
  id: string;
  name: string;
  created_at?: string;
  km2?: number | null;
};

type SponsorshipSlotInfo = {
  slot: number;
  taken: boolean;
  taken_by_me: boolean;
  status: string | null;
  owner_business_id: string | null;
  category_id: string | null;

  stripe_subscription_id: string | null;
  current_period_end: string | null;
  price_monthly_pennies: number | null;
  currency: string | null;
};

type SponsorshipAreaInfo = {
  area_id: string;
  slots: SponsorshipSlotInfo[];
};

const EPS = 1e-6;

export default function ServiceAreasPanel({
  businessId,
  categoryId,
  areas,
  onPreviewGeoJSON,
  onClearPreview,
}: {
  businessId: string;
  categoryId: string; // ✅ REQUIRED (industry)
  areas: ServiceArea[];

  // optional map preview hooks
  onPreviewGeoJSON?: (gj: any | null) => void;
  onClearPreview?: () => void;
}) {
  const [sponsorship, setSponsorship] = useState<Map<string, SponsorshipSlotInfo>>(new Map());
  const [loadingSponsorship, setLoadingSponsorship] = useState(false);
  const [sponsorshipErr, setSponsorshipErr] = useState<string | null>(null);

  // We also keep a “remaining km2 cache” so the list can show Sold out without opening the modal
  const [remaining, setRemaining] = useState<Map<string, number>>(new Map()); // key areaId -> available_km2
  const [loadingRemaining, setLoadingRemaining] = useState(false);

  // Modal state
  const [sponsorOpen, setSponsorOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [activeArea, setActiveArea] = useState<ServiceArea | null>(null);

  const activeAreaId = activeArea?.id || null;

  // ---- 1) Load sponsorship ownership per area (category aware) ----
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!businessId || !categoryId || !areas?.length) return;

      setLoadingSponsorship(true);
      setSponsorshipErr(null);

      try {
        const res = await fetch("/.netlify/functions/area-sponsorship", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            businessId,
            categoryId,
            areaIds: areas.map((a) => a.id),
            slots: [1],
          }),
        });

        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          throw new Error(j?.error || j?.message || "Failed to load sponsorship");
        }

        const map = new Map<string, SponsorshipSlotInfo>();
        const rows: SponsorshipAreaInfo[] = j.areas || [];
        for (const r of rows) {
          const slotInfo = (r.slots || []).find((s) => Number(s.slot) === 1);
          if (slotInfo) map.set(r.area_id, slotInfo);
        }

        if (!cancelled) setSponsorship(map);
      } catch (e: any) {
        if (!cancelled) setSponsorshipErr(e?.message || "Failed to load sponsorship");
      } finally {
        if (!cancelled) setLoadingSponsorship(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [businessId, categoryId, areas]);

  // ---- 2) Load remaining km² per area (category aware) ----
  // This is what makes “Sold out” correct without clicking the modal.
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!businessId || !categoryId || !areas?.length) return;

      setLoadingRemaining(true);
      try {
        // parallel but not too heavy — if you have loads of areas,
        // you can batch this server-side later.
        const entries = await Promise.all(
          areas.map(async (a) => {
            try {
              const res = await fetch("/.netlify/functions/sponsored-preview", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  businessId,
                  areaId: a.id,
                  slot: 1,
                  categoryId,
                }),
              });

              const j = await res.json().catch(() => null);
              if (!res.ok || !j?.ok) return [a.id, 0] as const;

              const available = typeof j.available_km2 === "number" ? j.available_km2 : 0;
              return [a.id, Math.max(0, available)] as const;
            } catch {
              return [a.id, 0] as const;
            }
          })
        );

        if (cancelled) return;

        const map = new Map<string, number>();
        for (const [id, avail] of entries) map.set(id, avail);
        setRemaining(map);
      } finally {
        if (!cancelled) setLoadingRemaining(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [businessId, categoryId, areas]);

  // helpers
  const slotInfoFor = (areaId: string) => sponsorship.get(areaId) || null;

  const openSponsor = (area: ServiceArea) => {
    setActiveArea(area);
    setSponsorOpen(true);
  };

  const openManage = (area: ServiceArea) => {
    setActiveArea(area);
    setManageOpen(true);
  };

  const closeAll = () => {
    setSponsorOpen(false);
    setManageOpen(false);
    setActiveArea(null);
  };

  // When cancel finishes, refresh sponsorship + remaining
  const refresh = async () => {
    // easiest: just trigger useEffects by re-setting state
    // (or you can refactor into functions)
    setSponsorship(new Map(sponsorship));
    setRemaining(new Map(remaining));
    // more robust: reload page data in your app if you already have a loader
    window.location.reload();
  };

  return (
    <div className="space-y-3">
      {sponsorshipErr && (
        <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-2">
          {sponsorshipErr}
        </div>
      )}

      <div className="rounded-xl border bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-lg">Service Areas</div>
            <div className="text-xs text-gray-500">
              Industry: <span className="font-mono">{categoryId}</span>
            </div>
          </div>
          <div className="text-xs text-gray-500">
            {(loadingSponsorship || loadingRemaining) ? "Checking availability…" : ""}
          </div>
        </div>

        <div className="mt-3 space-y-3">
          {areas.map((a) => {
            const slotInfo = slotInfoFor(a.id);
            const takenByMe = Boolean(slotInfo?.taken_by_me);
            const taken = Boolean(slotInfo?.taken);

            // remaining km2 decides “sold out” when user doesn’t own it
            const avail = remaining.get(a.id) ?? 0;
            const canBuyRemaining = avail > EPS;

            // ✅ FINAL UI STATE:
            // - if taken_by_me: show Manage
            // - else if canBuyRemaining: show Sponsor
            // - else show Sold out
            const showManage = takenByMe;
            const showSponsor = !takenByMe && canBuyRemaining;
            const showSoldOut = !takenByMe && !canBuyRemaining;

            return (
              <div key={a.id} className="border rounded-xl p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{a.name}</div>
                    <div className="text-xs text-gray-500">
                      {a.created_at ? new Date(a.created_at).toLocaleString() : ""}
                      {typeof a.km2 === "number" ? ` • ${a.km2.toFixed(2)} km²` : ""}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <button className="btn">Edit</button>
                      <button className="btn">Delete</button>
                      <button className="btn">Copy</button>
                    </div>

                    <div className="mt-2 text-xs text-gray-500">
                      {showManage && (
                        <span className="inline-flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                            Sponsored by you
                          </span>
                          <span>Status: {slotInfo?.status || "—"}</span>
                        </span>
                      )}

                      {!showManage && showSponsor && (
                        <span className="inline-flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Available
                          </span>
                          <span>Remaining: {avail.toFixed(3)} km²</span>
                        </span>
                      )}

                      {!showManage && showSoldOut && (
                        <span className="inline-flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                            Sold out
                          </span>
                          <span>
                            {taken ? "Overlaps fully with sponsored area" : "No remaining purchasable area"}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {showManage && (
                      <button className="btn btn-primary" onClick={() => openManage(a)}>
                        Manage
                      </button>
                    )}

                    {showSponsor && (
                      <button className="btn btn-primary" onClick={() => openSponsor(a)}>
                        Sponsor (Featured)
                      </button>
                    )}

                    {showSoldOut && (
                      <div className="text-xs text-gray-500">Not purchaseable</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {!areas.length && (
            <div className="text-sm text-gray-500">No service areas yet.</div>
          )}
        </div>
      </div>

      {/* Sponsor modal (buy remaining sub-region for this industry) */}
      <AreaSponsorModal
        open={sponsorOpen}
        onClose={closeAll}
        businessId={businessId}
        categoryId={categoryId}
        areaId={activeAreaId || ""}
        slot={1}
        areaName={activeArea?.name}
        onPreviewGeoJSON={onPreviewGeoJSON}
        onClearPreview={onClearPreview}
      />

      {/* Manage modal (owned by you) */}
      <ManageSponsorModal
        open={manageOpen}
        onClose={closeAll}
        businessId={businessId}
        categoryId={categoryId}
        areaId={activeAreaId || ""}
        slot={1}
        areaName={activeArea?.name}
        stripeSubscriptionId={activeAreaId ? (slotInfoFor(activeAreaId)?.stripe_subscription_id ?? null) : null}
        currentPeriodEnd={activeAreaId ? (slotInfoFor(activeAreaId)?.current_period_end ?? null) : null}
        priceMonthlyPennies={activeAreaId ? (slotInfoFor(activeAreaId)?.price_monthly_pennies ?? null) : null}
        currency={activeAreaId ? (slotInfoFor(activeAreaId)?.currency ?? null) : null}
        onCanceled={refresh}
      />
    </div>
  );
}
