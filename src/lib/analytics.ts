// src/lib/analytics.ts
import { supabase } from "./supabase";

type EventName = "impression" | "click_message" | "click_website" | "click_phone";

/** Standard RPC logger (awaitable). */
export async function recordEvent(params: {
  cleanerId: string;
  areaId: string | null;
  event: EventName;
  sessionId?: string;
  meta?: Record<string, any>;
}) {
  const { cleanerId, areaId, event, sessionId, meta } = params;
  return supabase.rpc("record_event", {
    p_cleaner_id: cleanerId,
    p_area_id: areaId,
    p_event: event,
    p_session_id: sessionId ?? getOrCreateSessionId(),
    p_meta: meta ?? {},
  });
}

/** Fire-and-forget logger that survives page unload/app switch. */
export function recordEventBeacon(params: {
  cleanerId: string;
  areaId: string | null;
  event: EventName;
  sessionId?: string;
  meta?: Record<string, any>;
}) {
  const { cleanerId, areaId, event, sessionId, meta } = params;

  const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/record_event`;
  const body = JSON.stringify({
    p_cleaner_id: cleanerId,
    p_area_id: areaId,
    p_event: event,
    p_session_id: sessionId ?? getOrCreateSessionId(),
    p_meta: meta ?? {},
  });

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(url, blob);
      return;
    }
  } catch {
    // ignore and fall back
  }

  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    keepalive: true,
    body,
  }).catch(() => {});
}

/** Stable, anonymous session id for dedupe/attribution. */
export function getOrCreateSessionId(): string {
  const KEY = "nbg_session_id";
  try {
    let v = localStorage.getItem(KEY);
    if (!v) {
      v = (crypto as any)?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(KEY, v);
    }
    return v;
  } catch {
    // SSR or blocked storage: ephemeral fallback
    return (crypto as any)?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
