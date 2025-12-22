// src/lib/analytics.ts
export type AnalyticsEvent =
  | "impression"
  | "click_message"
  | "click_phone"
  | "click_website";

type RecordEventInput = {
  cleanerId: string;
  event: AnalyticsEvent;
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
    return crypto.randomUUID();
  }
}

export async function recordEvent(input: RecordEventInput): Promise<void> {
  const payload = {
    cleaner_id: input.cleanerId,
    event: input.event,
    session_id: input.sessionId ?? null,
    category_id: input.categoryId ?? null,
    area_id: input.areaId ?? null,
    meta: input.meta ?? {},
  };

  const url = `${window.location.origin}/api/record_event`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("record_event failed:", res.status, txt, payload);
    }
  } catch (e) {
    console.error("record_event fetch error:", e, payload);
  }
}
