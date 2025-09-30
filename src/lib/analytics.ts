// src/lib/analytics.ts
import { supabase } from "./supabase";

type EventName = "impression" | "click_message" | "click_website" | "click_phone";

/** Cache the current user's access token for auth.uid() RLS. */
let ACCESS_TOKEN: string | null = null;

// Initialize token cache and keep it fresh
void supabase.auth.getSession().then(({ data }) => {
  ACCESS_TOKEN = data.session?.access_token ?? null;
});
supabase.auth.onAuthStateChange((_event, session) => {
  ACCESS_TOKEN = session?.access_token ?? null;
});

/** Awaitable RPC — use for things that don't trigger navigation (e.g., impressions). */
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

/**
 * Click-safe logger: uses fetch with keepalive and proper Authorization headers.
 * Call this BEFORE navigating/opening external apps/tabs.
 */
export async function recordEventBeacon(params: {
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

  // IMPORTANT: include the user's JWT, not just the anon key, for RLS to pass.
  const auth = ACCESS_TOKEN ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${auth}`,
      Prefer: "return=minimal",
    },
    // keepalive lets the request continue during navigation/unload
    keepalive: true,
    body,
  }).catch(() => {
    // swallow — this is fire-and-forget
  });
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
