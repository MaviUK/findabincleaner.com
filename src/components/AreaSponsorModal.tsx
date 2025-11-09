 import React, { useEffect, useMemo, useState } from "react";
 
 type Props = {
   open: boolean;
   onClose: () => void;
 
   businessId: string;         // cleaner/business id
   areaId: string;             // service area id
+  slot?: 1 | 2 | 3;           // service slot (defaults to 1 for legacy callers)
 
   // Map overlay callbacks from the editor
   onPreviewGeoJSON?: (multi: any) => void;
   onClearPreview?: () => void;
 
   // Total area of the selected service area (km²) – computed by the caller
   totalKm2?: number;
 };
 
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
+  slot = 1,
   onPreviewGeoJSON,
   onClearPreview,
   totalKm2,
 }: Props) {
   const [loading, setLoading] = useState(false);
   const [checkingOut, setCheckingOut] = useState(false);
   const [err, setErr] = useState<string | null>(null);
 
   const [availableKm2, setAvailableKm2] = useState<number | null>(null);
   const [currency, setCurrency] = useState<string>("GBP");
 
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
 
   useEffect(() => {
     if (!open) return;
     let cancelled = false;
 
     async function loadPreview() {
       setLoading(true);
       setErr(null);
       try {
         const res = await fetch("/.netlify/functions/sponsored-preview", {
           method: "POST",
           headers: { "content-type": "application/json" },
-          body: JSON.stringify({
-            businessId,
-            cleanerId: businessId, // same id in your schema
-            areaId,
-            slot: 1, // single-slot model
-          }),
-        });
+        body: JSON.stringify({
+          businessId,
+          cleanerId: businessId, // same id in your schema
+          areaId,
+          slot,
+        }),
+      });
 
         if (!res.ok) {
           throw new Error(`Preview failed (${res.status})`);
         }
 
         const data: PreviewResponse = await res.json();
         if (!data?.ok) {
           throw new Error(data?.error || "Preview not available");
         }
 
         if (cancelled) return;
 
         // overlay
         if (data.geojson && onPreviewGeoJSON) onPreviewGeoJSON(data.geojson);
 
         // available km² (from server)
         const avail = typeof data.area_km2 === "number" ? Math.max(0, data.area_km2) : 0;
         setAvailableKm2(avail);
 
         // currency
         setCurrency(data.unit_currency || "GBP");
 
         // pricing
         // Prefer server-provided major-unit fields. Fall back to pence if supplied.
         const unit =
@@ -151,51 +153,51 @@ export default function AreaSponsorModal({
     }
 
     loadPreview();
     return () => {
       cancelled = true;
     };
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
       const res = await fetch("/.netlify/functions/sponsored-checkout", {
         method: "POST",
         headers: { "content-type": "application/json" },
         body: JSON.stringify({
           businessId,
           cleanerId: businessId,
           areaId,
-          slot: 1, // single-slot world
+          slot,
         }),
       });
       const data = await res.json();
       if (!res.ok || !data?.url) throw new Error(data?.error || "Could not start checkout");
       window.location.href = data.url; // redirect to Stripe
     } catch (e: any) {
       setErr(e?.message || "Checkout failed");
       setCheckingOut(false);
     }
   }
 
   if (!open) return null;
 
   const total = totalKm2 ?? null;
   const avail = availableKm2;
 
   return (
     <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
       <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl ring-1 ring-black/5 overflow-hidden">
         <div className="px-5 py-4 border-b flex items-center justify-between">
           <h3 className="font-semibold text-lg">Sponsor this Area</h3>
           <button className="text-sm opacity-70 hover:opacity-100" onClick={close}>
             Close
           </button>
         </div>
 
EOF
)
