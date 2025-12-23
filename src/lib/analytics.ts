// src/lib/analytics.ts
type AnalyticsEventName = "impression" | "click_message" | "click_phone" | "click_website";

type RecordEventPayload = {
  cleanerId: string;
  event: AnalyticsEventName;

  // Optional attribution
  areaId?: string | null;
  categoryId?: string | null;
  sessionId?: string | null;

  // Any extra context
  meta?: Record<string, any>;
};

const SESSION_KEY = "clnly_session_id";

export function getOrCreateSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id =
      (crypto as any)?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    // no localStorage (private mode etc.)
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

/**
 * Primary: sendBeacon (doesn't block navigation)
 * Fallback: fetch keepalive
 */
export async function recordEventBeacon(payload: RecordEventPayload): Promise<void> {
  try {
    const body = JSON.stringify(payload);

    // Try sendBeacon first
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      const ok = navigator.sendBeacon(
        "/api/record_event",
        new Blob([body], { type: "application/json" })
      );
      if (ok) return;
      // if sendBeacon returns false, fall through to fetch
    }

    // Fallback to fetch
    await fetch("/api/record_event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    });
  } catch (e) {
    // Never throw from analytics
    console.warn("recordEventBeacon failed", e);
  }
}

/**
 * Convenience: includes a lat/lng point in meta if you want it (optional).
 * Keeping this because your codebase referenced it.
 */
export async function recordEventFromPointBeacon(args: RecordEventPayload & { lat?: number; lng?: number }) {
  const { lat, lng, meta, ...rest } = args;
  await recordEventBeacon({
    ...rest,
    meta: {
      ...(meta || {}),
      ...(typeof lat === "number" ? { lat } : {}),
      ...(typeof lng === "number" ? { lng } : {}),
    },
  });
}
