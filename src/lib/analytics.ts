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
  areaId?: string | null;
  sessionId?: string | null;
  meta?: Record<string, any>;
};

/**
 * Uses FETCH (keepalive) so it ALWAYS shows in DevTools Network (Fetch/XHR)
 * and works on page navigations.
 *
 * Tries /api/record_event first (your netlify redirect),
 * falls back to /.netlify/functions/record_event if needed.
 */
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

async function postJSON(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
    credentials: "omit",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`record_event ${res.status}: ${text || res.statusText}`);
  }

  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function recordEventFetch(payload: RecordEventPayload) {
  // ✅ guard: don't send invalid events
  if (!payload.cleanerId) return null;

  // shape expected by your function/db (snake_case)
  const body = {
    event: payload.event,
    cleaner_id: payload.cleanerId,
    category_id: payload.categoryId ?? null,
    area_id: payload.areaId ?? null,
    session_id: payload.sessionId ?? null,
    meta: payload.meta ?? {},
  };

  try {
    return await postJSON(PRIMARY_ENDPOINT, body);
  } catch (e) {
    return await postJSON(FALLBACK_ENDPOINT, body);
  }
}
