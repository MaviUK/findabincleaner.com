// src/lib/analytics.ts
export type AnalyticsEvent =
  | "impression"
  | "click_message"
  | "click_phone"
  | "click_website";

export type RecordEventPayload = {
  event: AnalyticsEvent;
  cleanerId: string;
  categoryId?: string | null;

  // ⚠️ still accepted for backwards compatibility, but server prefers computed area_id
  areaId?: string | null;

  // ✅ NEW: search/user origin point so server can resolve correct area_id
  lat?: number | null;
  lng?: number | null;

  sessionId?: string | null;
  meta?: Record<string, any>;
};

const PRIMARY_ENDPOINT = "/api/record_event";
const FALLBACK_ENDPOINT = "/.netlify/functions/record_event";

export function getOrCreateSessionId(): string {
  const key = "cl_session_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id =
    (globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`) + "";
  localStorage.setItem(key, id);
  return id;
}

function buildBody(payload: RecordEventPayload) {
  return {
    event: payload.event,
    cleaner_id: payload.cleanerId,
    category_id: payload.categoryId ?? null,

    // still sent (fallback), but record_event will compute area_id if lat/lng provided
    area_id: payload.areaId ?? null,

    // ✅ NEW: used by record_event -> area_for_point RPC
    lat: payload.lat ?? null,
    lng: payload.lng ?? null,

    session_id: payload.sessionId ?? null,
    meta: payload.meta ?? {},
  };
}

// ✅ Use Beacon for clicks (most reliable), fallback to fetch keepalive
async function postEvent(url: string, body: any, preferBeacon: boolean) {
  const json = JSON.stringify(body);

  if (preferBeacon && navigator.sendBeacon) {
    const ok = navigator.sendBeacon(
      url,
      new Blob([json], { type: "application/json" })
    );
    if (ok) return { ok: true, via: "beacon" };
    // fall through to fetch if beacon fails
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: json,
    keepalive: true,
    credentials: "omit",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`record_event ${res.status}: ${text || res.statusText}`);
  }

  return { ok: true, via: "fetch" };
}

export async function recordEventFetch(payload: RecordEventPayload) {
  if (!payload.cleanerId) return null;

  const body = buildBody(payload);
  const preferBeacon =
    payload.event === "click_message" ||
    payload.event === "click_phone" ||
    payload.event === "click_website";

  try {
    return await postEvent(PRIMARY_ENDPOINT, body, preferBeacon);
  } catch {
    return await postEvent(FALLBACK_ENDPOINT, body, preferBeacon);
  }
}
