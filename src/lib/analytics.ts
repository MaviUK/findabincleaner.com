// src/lib/analytics.ts
type RecordEventInput = {
  cleanerId: string;
  event: "impression" | "click_message" | "click_phone" | "click_website";
  sessionId?: string | null;
  categoryId?: string | null;
  areaId?: string | null;
  meta?: Record<string, any>;
};

const SESSION_KEY = "cleanly_session_id";

export function getOrCreateSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    // If storage blocked, still return a usable id per page load
    return crypto.randomUUID();
  }
}

/**
 * Fire-and-forget event recorder.
 * Uses fetch(keepalive) to avoid beacon inconsistencies across browsers/adblock.
 * Hits /api/record_event which you redirect to the Netlify function.
 */
export async function recordEventBeacon(input: RecordEventInput): Promise<void> {
  const payload = {
    cleaner_id: input.cleanerId,
    event: input.event,
    session_id: input.sessionId ?? null,
    category_id: input.categoryId ?? null,
    area_id: input.areaId ?? null,
    meta: input.meta ?? {},
  };

  try {
    await fetch("/api/record_event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // keepalive allows the request to complete even when navigating away
      keepalive: true,
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // fallback (direct functions path) if redirects/proxies fail for any reason
    try {
      await fetch("/.netlify/functions/record_event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify(payload),
      });
    } catch {
      // swallow
    }
  }
}
