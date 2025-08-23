import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  GoogleMap,
  useLoadScript,
  DrawingManager,
  Polygon as GPolygon,
  StandaloneSearchBox,
} from "@react-google-maps/api";

type Cleaner = {
  id: string;
  user_id: string;
  business_name: string | null;
  logo_url: string | null;
  address: string | null;
  subscription_status: "active" | "incomplete" | "past_due" | "canceled" | null;
};

export default function CleanerOnboard({ userId, cleaner }: { userId: string; cleaner: Cleaner }) {
  const [businessName, setBusinessName] = useState(cleaner.business_name || "");
  const [address, setAddress] = useState(cleaner.address || "");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Polygon state
  const [ring, setRing] = useState<google.maps.LatLngLiteral[] | null>(null);

  // Map & Places
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY as string,
    libraries: ["drawing", "places"],
  });
  const center = useMemo(() => ({ lat: 54.6079, lng: -5.9264 }), []);
  const searchBoxRef = useRef<google.maps.places.SearchBox | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onSBLoad = (ref: google.maps.places.SearchBox) => (searchBoxRef.current = ref);
  const onPlacesChanged = () => {
    const sb = searchBoxRef.current;
    if (!sb) return;
    const places = sb.getPlaces();
    if (!places || !places[0]) return;
    const p = places[0];
    setAddress(p.formatted_address || inputRef.current?.value || "");
  };

  const onPolygonComplete = (poly: google.maps.Polygon) => {
    const path = poly.getPath();
    const coords: google.maps.LatLngLiteral[] = [];
    for (let i = 0; i < path.getLength(); i++) {
      const p = path.getAt(i);
      coords.push({ lat: p.lat(), lng: p.lng() });
    }
    // close ring if needed
    if (coords.length) {
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first.lat !== last.lat || first.lng !== last.lng) coords.push(first);
    }
    setRing(coords);
    poly.setMap(null); // remove the editable instance
  };

  // Helper: upload logo
  const uploadLogo = async (): Promise<string | null> => {
    if (!logoFile) return cleaner.logo_url || null;
    const fileExt = logoFile.name.split(".").pop();
    const objectName = `${userId}/logo.${fileExt}`;
    const { error: upErr } = await supabase.storage.from("logos").upload(objectName, logoFile, {
      cacheControl: "3600",
      upsert: true,
      contentType: logoFile.type || "image/png",
    });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from("logos").getPublicUrl(objectName);
    return data.publicUrl; // or keep private & sign URLs if you prefer
  };

  const save = async () => {
    setSaving(true); setMsg(null); setError(null);
    try {
      // 1) Upload logo if provided
      const logoUrl = await uploadLogo();

      // 2) Geocode "address" (using Places result if available)
      // Lightweight approach: use the Places input to bias, but
      // for server-side integrity, you could use postcodes.io or Google Geocoding.
      // Here we do a client geocode via Maps Geocoder:
      let latLng: google.maps.LatLngLiteral | null = null;
      if (address && isLoaded && (window as any).google?.maps?.Geocoder) {
        latLng = await new Promise<google.maps.LatLngLiteral | null>((resolve) => {
          const geocoder = new google.maps.Geocoder();
          geocoder.geocode({ address }, (results, status) => {
            if (status === "OK" && results && results[0]) {
              const g = results[0].geometry.location;
              resolve({ lat: g.lat(), lng: g.lng() });
            } else resolve(null);
          });
        });
      }

      // 3) Update cleaner row
      const payload: Partial<Cleaner> = {
        business_name: businessName || cleaner.business_name,
        address: address || cleaner.address,
        logo_url: logoUrl || cleaner.logo_url,
      };

      const { error: upErr } = await supabase.from("cleaners").update(payload).eq("id", cleaner.id);
      if (upErr) throw upErr;

      // 3b) Save point location if we got one
      if (latLng) {
        // Small RPC to set point (safer than exposing ST_SetSRID in client)
        const { error: locErr } = await supabase.rpc("set_cleaner_location", {
          p_cleaner_id: cleaner.id,
          p_lat: latLng.lat,
          p_lng: latLng.lng,
        });
        if (locErr) throw locErr;
      }

      // 4) Save polygon if user drew one
      if (ring && ring.length >= 4) {
        const coords = ring.map(({ lng, lat }) => [lng, lat]) as [number, number][];
        const geojson = { type: "MultiPolygon", coordinates: [[coords]] };
        const { error: areaErr } = await supabase.rpc("insert_service_area", {
          cleaner_id: cleaner.id,
          gj: geojson,
          name: "Primary Area",
        });
        if (areaErr) throw areaErr;
      }

      setMsg("Saved! You can now subscribe and start receiving leads.");
    } catch (e: any) {
      setError(e.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <div>Failed to load Google Maps.</div>;

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* Left: Business info */}
      <div className="space-y-3 p-4 border rounded-xl">
        <h2 className="text-xl font-semibold">Business details</h2>
        <label className="block">
          <span className="text-sm">Business name</span>
          <input
            className="w-full border rounded px-3 py-2"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g., Wheelie Clean Andy"
          />
        </label>

        <label className="block">
          <span className="text-sm">Logo</span>
          <input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} />
          {cleaner.logo_url && (
            <div className="mt-2">
              <img src={cleaner.logo_url} alt="logo" className="h-12" />
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

        <button
          className="bg-black text-white rounded px-4 py-2"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save details"}
        </button>

        {msg && <div className="text-green-700 text-sm">{msg}</div>}
        {error && <div className="text-red-700 text-sm">{error}</div>}
      </div>

      {/* Right: Draw service area */}
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
                  drawingControlOptions: {
                    drawingModes: [google.maps.drawing.OverlayType.POLYGON],
                  },
                  polygonOptions: {
                    fillOpacity: 0.2,
                    strokeWeight: 2,
                    clickable: false,
                    editable: false,
                  },
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
