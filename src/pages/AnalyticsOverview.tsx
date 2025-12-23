// src/lib/analytics.ts
import { supabase } from "./supabase";

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

export type AnalyticsEvent =
  | "impression"
  | "click_message"
  | "click_phone"
  | "click_website";

export function getOrCreateSessionId(): string {
  try {
    const key = "cl_session_id";
    const existing = localStorage.getItem(key);
    if (existing) return existing;

    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

type RecordEventArgs = {
  cleanerId: string;
  event: AnalyticsEvent;
  sessionId?: string;
  areaId?: string | null;
  categoryId?: string | null;
  meta?: Record<string, Json>;
};

type RecordEventFromPointArgs = {
  cleanerId: string;
  lat: number;
  lng: number;
  event: AnalyticsEvent;
  sessionId?: string;
  categoryId?: string | null;
  meta?: Record<string, Json>;
};

/**
 * INTERNAL: send a POST to Supabase REST RPC with keepalive (so it survives navigation)
 */
function postRpcKeepalive(rpcName: string, body: any) {
  // supabase-js v2 exposes these
  const anyClient: any = supabase as any;
  const supabaseUrl: string | undefined = anyClient?.supabaseUrl;
  const supabaseKey: string | undefined = anyClient?.supabaseKey;

  if (!supabaseUrl || !supabaseKey) {
    // fallback: best effort (may get cancelled on nav)
    // still useful for local testing
    return supabase.rpc(rpcName, body);
  }

  const url = `${supabaseUrl}/rest/v1/rpc/${rpcName}`;
  const payload = JSON.stringify(body);

  // If browser supports beacon, use it (most reliable during unload/nav)
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon(url, blob);
    return;
  }

  // Otherwise use fetch keepalive
  fetch(url, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: payload,
    keepalive: true,
    mode: "cors",
    credentials: "omit",
  }).catch(() => {
    // ignore errors (analytics should never break UX)
  });
}

/**
 * Writes via area-based RPC.
 * If you want a "reliable" call before navigation, use recordEventBeacon().
 */
export async function recordEvent({
  cleanerId,
  areaId,
  event,
  sessionId,
  categoryId,
  meta,
}: RecordEventArgs) {
  const sid = sessionId ?? getOrCreateSessionId();

  if (!areaId) {
    throw new Error("recordEvent requires areaId. Use recordEventFromPointBeacon instead.");
  }

  const payload: any = {
    p_cleaner_id: cleanerId,
    p_area_id: areaId,
    p_event: event,
    p_session_id: sid,
    p_meta: meta ?? {},
    p_category_id: categoryId ?? null,
  };

  const { error } = await supabase.rpc("record_event", payload);
  if (error) throw error;
}

/**
 * Reliable "beacon-like" event logger for area-based events.
 * This is what you should call from clicks before opening new tabs.
 */
export function recordEventBeacon(args: RecordEventArgs) {
  const sid = args.sessionId ?? getOrCreateSessionId();

  // If areaId is missing, still record (area_id will be null)
  const payload: any = {
    p_cleaner_id: args.cleanerId,
    p_area_id: args.areaId ?? null,
    p_event: args.event,
    p_session_id: sid,
    p_meta: args.meta ?? {},
    p_category_id: args.categoryId ?? null,
  };

  postRpcKeepalive("record_event", payload);
}

/**
 * Point-based RPC (DB finds area from lat/lng).
 */
export async function recordEventFromPointBeacon({
  cleanerId,
  lat,
  lng,
  event,
  sessionId,
  categoryId,
  meta,
}: RecordEventFromPointArgs) {
  const sid = sessionId ?? getOrCreateSessionId();

  const payload: any = {
    p_cleaner_id: cleanerId,
    p_lat: lat,
    p_lng: lng,
    p_event: event,
    p_session_id: sid,
    p_meta: meta ?? {},
    p_category_id: categoryId ?? null,
  };

  // reliable send (survives navigation)
  postRpcKeepalive("record_event_from_point", payload);
}

/**
 * Compatibility wrapper (if anything imports recordEventFromPoint)
 */
export async function recordEventFromPoint(args: RecordEventFromPointArgs) {
  return recordEventFromPointBeacon(args);
}
