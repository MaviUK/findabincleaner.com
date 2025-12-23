// src/lib/analytics.ts
export type AnalyticsEvent =
  | "impression"
  | "click_message"
  | "click_website"
  | "click_phone";

export function getOrCreateSessionId(): string {
  try {
    const key = "cl_session_id";
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    // fallback
    return crypto.randomUUID();
  }
}

function endpoint() {
  // always use the Netlify redirect
  return "/api/record_event";
}

export async function recordEvent(payload: {
  event: AnalyticsEvent;
  cleanerId: string;
  categoryId?: string | null;
  areaId?: string | null;
  sessionId?: string | null;
  meta?: Record<string, any>;
  uniq?: string | null;
}): Promise<void> {
  const body = {
    event: payload.event,
    cleaner_id: payload.cleanerId,
    category_id: payload.categoryId ?? null,
    area_id: payload.areaId ?? null,
    session_id: payload.sessionId ?? null,
    meta: payload.meta ?? {},
    uniq: payload.uniq ?? null,
  };

  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.warn("record_event failed", res.status, txt);
  }
}

/**
 * Best effort: use sendBeacon if available; fallback to fetch(keepalive).
 */
export function recordEventBeacon(payload: {
  event: AnalyticsEvent;
  cleanerId: string;
  categoryId?: string | null;
  areaId?: string | null;
  sessionId?: string | null;
  meta?: Record<string, any>;
  uniq?: string | null;
}): void {
  const body = JSON.stringify({
    event: payload.event,
    cleaner_id: payload.cleanerId,
    category_id: payload.categoryId ?? null,
    area_id: payload.areaId ?? null,
    session_id: payload.sessionId ?? null,
    meta: payload.meta ?? {},
    uniq: payload.uniq ?? null,
  });

  try {
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(endpoint(), new Blob([body], { type: "application/json" }));
      if (ok) return;
    }
  } catch {}

  // fallback
  void fetch(endpoint(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

/**
 * Convenience helper: you give it a point (lat/lng) and we store in meta too.
 */
export function recordEventFromPointBeacon(payload: {
  event: AnalyticsEvent;
  cleanerId: string;
  categoryId?: string | null;
  areaId?: string | null;
  sessionId?: string | null;
  lat?: number;
  lng?: number;
  meta?: Record<string, any>;
  uniq?: string | null;
}): void {
  recordEventBeacon({
    event: payload.event,
    cleanerId: payload.cleanerId,
    categoryId: payload.categoryId ?? null,
    areaId: payload.areaId ?? null,
    sessionId: payload.sessionId ?? null,
    uniq: payload.uniq ?? null,
    meta: {
      ...(payload.meta ?? {}),
      ...(typeof payload.lat === "number" ? { lat: payload.lat } : {}),
      ...(typeof payload.lng === "number" ? { lng: payload.lng } : {}),
    },
  });
}
