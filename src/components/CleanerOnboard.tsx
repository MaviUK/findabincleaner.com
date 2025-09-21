// src/components/CleanerOnboard.tsx
import { useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  GoogleMap,
  useLoadScript,
  DrawingManager,
  Polygon as GPolygon,
  StandaloneSearchBox,
} from "@react-google-maps/api";

export type Cleaner = {
  id: string;
  user_id: string;
  business_name: string | null;
  logo_url: string | null;
  address: string | null;
  subscription_status: "active" | "incomplete" | "past_due" | "canceled" | null;
  phone?: string | null;
  website?: string | null;
  about?: string | null;
  contact_email?: string | null;
};

type Props = {
  userId: string;
  cleaner: Cleaner;
  onSaved?: (patch: Partial<Cleaner>) => void;
};

/** Resize any image file to exactly 300x300 using "contain" (no crop), centered, transparent padding */
async function resizeTo300PNG(file: File): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = URL.createObjectURL(file);
  });

  const target = 300;
  const canvas = document.createElement("canvas");
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext("2d")!;

  // If you want a white square background instead of transparent, uncomment:
  // ctx.fillStyle = "#ffffff";
  // ctx.fillRect(0, 0, target, target);

  // keep aspect ratio (CONTAIN)
  const scale = Math.min(target / img.width, target / img.height);
  const drawW = Math.round(img.width * scale);
  const drawH = Math.round(img.height * scale);
  const dx = Math.floor((target - drawW) / 2);
  const dy = Math.floor((target - drawH) / 2);

  ctx.drawImage(img, dx, dy, drawW, drawH);

  return await new Promise<Blob>((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), "image/png", 0.92);
  });
}

export default function CleanerOnboard({ userId, cleaner, onSaved }: Props) {
  const [businessName, setBusinessName] = useState(cleaner.business_name ?? "");
  const [address, setAddress] = useState(cleaner.address ?? "");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(cleaner.logo_url || null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [ring, setRing] = useState<google.maps.LatLngLiteral[] | null>(null);

  // ↓ memoize libraries to avoid "LoadScript reloaded" warning
  const libraries = useMemo(() => ["drawing", "places"] as const, []);
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY as string,
    libraries,
  });

  const center = useMemo(() => ({ lat: 54.6079, lng: -5.9264 }), []);
  const searchBoxRef = useRef<google.maps.places.SearchBox | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onSBLoad = (ref: google.maps.places.SearchBox) => (searchBoxRef.current = ref);
  const onPlacesChanged = () => {
    const sb = searchBoxRef.current;
    const place = sb?.getPlaces()?.[0];
    if (!place) return;
    setAddress(place.formatted_address || inputRef.current?.value || "");
  };

  const onPolygonComplete = (poly: google.maps.Polygon) => {
    const path = poly.getPath();
    const coords: google.maps.LatLngLiteral[] = [];
    for (let i = 0; i < path.getLength(); i++) {
      const p = path.getAt(i);
      coords.push({ lat: p.lat(), lng: p.lng() });
    }
    if (coords.length) {
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first.lat !== last.lat || first.lng !== last.lng) coords.push(first);
    }
    setRing(coords);
    poly.setMap(null);
  };

  /** Upload resized (300x300) logo to Storage and return public URL */
  const uploadLogo = async (): Promise<string | null> => {
    if (!logoFile) return cleaner.logo_url || null;

    // 1) resize to 300x300 PNG
    const resized = await resizeTo300PNG(logoFile);

    // 2) upload (always PNG after resize)
    const objectName = `${userId}/logo.png`;
    const { error: upErr } = await supabase.storage
      .from("logos") // ensure bucket 'logos' exists & is Public
      .upload(objectName, resized, {
        upsert: true,
        cacheControl: "3600",
        contentType: "image/png",
      });

    if (upErr) throw upErr;

    // 3) get public URL
    const { data } = supabase.storage.from("logos").getPublicUrl(objectName);
    setLogoPreview(data.publicUrl);
    return data.publicUrl;
  };

  const save = async () => {
    setSaving(true); setMsg(null); setError(null);
    try {
      const logoUrl = await uploadLogo();

      // optional client geocode
      let latLng: google.maps.LatLngLiteral | null = null;
      if (address && isLoaded && (window as any).google?.maps?.Geocoder) {
        latLng = await new Promise<google.maps.LatLngLiteral | null>((resolve) => {
          const geocoder = new google.maps.Geocoder();
          geocoder.geocode({ address }, (results, status) => {
            if (status === "OK" && results?.[0]) {
              const g = results[0].geometry.location;
              resolve({ lat: g.lat(), lng: g.lng() });
            } else resolve(null);
          });
        });
      }

      const payload: Partial<Cleaner> = {
        business_name: businessName || cleaner.business_name,
        address: address || cleaner.address,
        logo_url: logoUrl || cleaner.logo_url,
      };

      const { error: upErr } = await supabase.from("cleaners").update(payload).eq("id", cleaner.id);
      if (upErr) throw upErr;

      if (latLng) {
        const { error: locErr } = await supabase.rpc("set_cleaner_location", {
          p_cleaner_id: cleaner.id, p_lat: latLng.lat, p_lng: latLng.lng,
        });
        if (locErr) throw locErr;
      }

      if (ring && ring.length >= 4) {
        const coords = ring.map(({ lng, lat }) => [lng, lat]) as [number, number][];
        const geojson = { type: "MultiPolygon", coordinates: [[coords]] };
        const { error: areaErr } = await supabase.rpc("insert_service_area", {
          cleaner_id: cleaner.id, gj: geojson, name: "Primary Area",
        });
        if (areaErr) throw areaErr;
      }

      setMsg("Saved! You can now start receiving leads.");
      onSaved?.({
        business_name: payload.business_name ?? null,
        address: payload.address ?? null,
        logo_url: payload.logo_url ?? null,
      });
    } catch (e: any) {
      setError(e.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <div>Failed to load Google Maps.</div>;

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-3 p-4 border rounded-xl">
        <h2 className="text-xl font-semibold">Business details</h2>

        <label className="block">
          <span className="text-sm">Business name</span>
          <input
            className="w-full border rounded px-3 py-2"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-sm">Logo</span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setLogoFile(f);
              if (f) setLogoPreview(URL.createObjectURL(f));
            }}
          />
          {logoPreview && (
            <div className="mt-2">
              {/* constrain preview in UI too */}
              <img src={logoPreview} alt="logo" className="h-20 w-20 object-contain rounded" />
            </div>
          )}
        </label>

        <label className="block">
          <span className="text-sm">Business address</span>
          {isLoaded ? (
            <StandaloneSearchBox onLoad={onSBLoad} onPlacesChanged={onPlacesChanged}>
              <input
                ref={inputRef}
                className="w-full border rounded px-3 py-2"
                placeholder="Start typing your address…"
                defaultValue={address || ""}
                onChange={(e) => setAddress(e.target.value)}
              />
            </StandaloneSearchBox>
          ) : (
            <input
              className="w-full border rounded px-3 py-2"
              placeholder="Start typing your address…"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          )}
        </label>

        <button className="bg-black text-white rounded px-4 py-2" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save details"}
        </button>

        {msg && <div className="text-green-700 text-sm">{msg}</div>}
        {error && <div className="text-red-700 text-sm">{error}</div>}
      </div>

      <div className="p-4 border rounded-xl">
        <h2 className="text-xl font-semibold mb-3">Select your service area</h2>
        <div className="h-[55vh] w-full rounded-lg overflow-hidden">
          {isLoaded ? (
            <GoogleMap zoom={11} center={center} mapContainerClassName="w-full h-full">
              {ring && <GPolygon paths={ring} options={{ editable: false }} />}
              <DrawingManager
                onPolygonComplete={onPolygonComplete}
                options={{
                  drawingControl: true,
                  drawingControlOptions: { drawingModes: [google.maps.drawing.OverlayType.POLYGON] },
                  polygonOptions: { fillOpacity: 0.2, strokeWeight: 2, clickable: false, editable: false },
                }}
              />
            </GoogleMap>
          ) : (
            <div>Loading map…</div>
          )}
        </div>
      </div>
    </div>
  );
}
