// src/lib/analytics.ts
type RecordEventInput = {
  cleanerId: string;
  event: "impression" | "click_message" | "click_phone" | "click_website";
  sessionId?: string;
  categoryId?: string | null;
  areaId?: string | null;
  lat?: number | null;
  lng?: number | null;
  meta?: Record<string, any>;
};

export function getOrCreateSessionId() {
  const key = "cl_session_id";
  let v = localStorage.getItem(key);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(key, v);
  }
  return v;
}

// ✅ IMPORTANT: hit Netlify function directly (no redirect)
function endpoint() {
  return "/.netlify/functions/record_event";
}

export async function recordEventBeacon(input: RecordEventInput) {
  const body = {
    cleaner_id: input.cleanerId,
    event: input.event,
    session_id: input.sessionId ?? getOrCreateSessionId(),
    category_id: input.categoryId ?? null,
    area_id: input.areaId ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    meta: input.meta ?? {},
  };

  // ✅ Force fetch so it always shows in Fetch/XHR
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // keepalive helps on navigation
    keepalive: true,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`record_event failed: ${res.status} ${txt}`);
  }
}

export function recordEventFromPointBeacon(
  input: Omit<RecordEventInput, "lat" | "lng"> & { lat: number; lng: number }
) {
  return recordEventBeacon({
    ...input,
    lat: input.lat,
    lng: input.lng,
  });
}
