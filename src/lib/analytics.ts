// src/lib/analytics.ts
type RecordEventArgs = {
  cleanerId: string;
  event: "impression" | "click_message" | "click_website" | "click_phone";
  sessionId?: string | null;
  categoryId?: string | null;
  areaId?: string | null;
  lat?: number | null;
  lng?: number | null;
  meta?: Record<string, any>;
};

export function getOrCreateSessionId(): string {
  const key = "cleanly_session_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

async function postKeepAlive(url: string, body: any) {
  // Prefer sendBeacon because it survives navigation best
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
      const ok = navigator.sendBeacon(url, blob);
      if (ok) return;
    }
  } catch {
    // ignore and fall back to fetch
  }

  // Fallback to fetch with keepalive
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  });
}

export async function recordEventBeacon(args: RecordEventArgs) {
  const payload = {
    event: args.event,
    cleaner_id: args.cleanerId,
    session_id: args.sessionId ?? null,
    category_id: args.categoryId ?? null,
    area_id: args.areaId ?? null,
    meta: args.meta ?? {},
  };

  await postKeepAlive("/api/record_event", payload);
}

/**
 * Variant that also sends lat/lng so the backend can determine area_id if missing.
 */
export async function recordEventFromPointBeacon(args: RecordEventArgs) {
  const payload = {
    event: args.event,
    cleaner_id: args.cleanerId,
    session_id: args.sessionId ?? null,
    category_id: args.categoryId ?? null,
    area_id: args.areaId ?? null,
    meta: {
      ...(args.meta ?? {}),
      lat: args.lat ?? null,
      lng: args.lng ?? null,
    },
  };

  await postKeepAlive("/api/record_event", payload);
}
