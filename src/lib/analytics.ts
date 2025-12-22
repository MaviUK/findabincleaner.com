// src/lib/analytics.ts
type RecordEventArgs = {
  cleanerId: string;
  event: "impression" | "click_message" | "click_phone" | "click_website";
  sessionId?: string | null;
  categoryId?: string | null;
  areaId?: string | null;
  meta?: Record<string, any>;
};

const SESSION_KEY = "cleanly_session_id";

/**
 * Always call the Netlify Function directly to avoid SPA redirect rules.
 * This removes the 300 redirect problem.
 */
function recordEventUrl() {
  // e.g. https://findabincleaner.netlify.app/.netlify/functions/record_event
  return `${window.location.origin}/.netlify/functions/record_event`;
}

export function getOrCreateSessionId() {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    // fallback if localStorage blocked
    return crypto.randomUUID();
  }
}

/**
 * Reliable "beacon-like" POST.
 * - keepalive lets it send while navigating away.
 * - no sendBeacon (some browsers/extensions block it).
 */
export async function recordEventBeacon(args: RecordEventArgs) {
  const payload = {
    cleaner_id: args.cleanerId,
    event: args.event,
    session_id: args.sessionId ?? getOrCreateSessionId(),
    category_id: args.categoryId ?? null,
    area_id: args.areaId ?? null,
    meta: args.meta ?? {},
  };

  const url = recordEventUrl();

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    // Important for page navigation events:
    keepalive: true,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`record_event failed ${res.status}: ${txt}`);
  }

  return true;
}
