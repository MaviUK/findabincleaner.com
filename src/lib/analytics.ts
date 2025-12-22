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

/** Stable per-device session id */
export function getOrCreateSessionId() {
  const key = "cl_session_id";
  let v = localStorage.getItem(key);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(key, v);
  }
  return v;
}

function endpoint() {
  // Uses your netlify redirect:
  // /api/record_event -> /.netlify/functions/record_event
  return "/api/record_event";
}

/**
 * Main sender. Uses sendBeacon when possible, otherwise fetch.
 * IMPORTANT: We do NOT require auth/cookies for this.
 */
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

  const url = endpoint();
  const payload = JSON.stringify(body);

  // Try beacon first (best for click tracking)
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      const ok = navigator.sendBeacon(url, blob);
      if (ok) return;
    }
  } catch {
    // ignore and fall back to fetch
  }

  // Fallback to fetch
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`record_event failed: ${res.status} ${txt}`);
  }
}

/**
 * If you have a lat/lng and want to store it as columns too.
 * (Some backends use these to resolve area_id server-side.)
 */
export function recordEventFromPointBeacon(input: Omit<RecordEventInput, "lat" | "lng"> & { lat: number; lng: number }) {
  return recordEventBeacon({
    ...input,
    lat: input.lat,
    lng: input.lng,
  });
}
