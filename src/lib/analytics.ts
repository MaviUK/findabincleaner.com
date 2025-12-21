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
 * ---------- IMPORTANT ----------
 * For "beacon-like" reliability on clicks (especially Website),
 * we call Supabase REST RPC directly with fetch({ keepalive: true }).
 *
 * supabase.rpc() can be cancelled by navigation / new tab.
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

async function rpcKeepalive(functionName: string, payload: any) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;

  // If user is logged in, include bearer token (helps if RLS checks auth).
  // If not logged in, anon key still works for public logging if your RPC permits it.
  let bearer = SUPABASE_ANON_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) bearer = token;
  } catch {
    // ignore
  }

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(payload),
      // ✅ this is the key for navigation safety
      keepalive: true,
      // keep it simple + compatible
      mode: "cors",
      credentials: "omit",
    });
  } catch {
    // swallow errors: analytics should never break UX
  }
}

/**
 * Writes via area-based RPC (awaited).
 * Use this when you *need* the write to finish (admin tools etc).
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
    throw new Error(
      "recordEvent requires areaId. Use recordEventFromPointBeacon instead."
    );
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
 * Writes via point-based RPC (awaited).
 * Use this when you *need* the write to finish (admin tools etc).
 */
export async function recordEventFromPoint({
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

  const { error } = await supabase.rpc("record_event_from_point", payload);
  if (error) throw error;
}

/**
 * ✅ "Beacon" versions (fire-and-forget, keepalive)
 * These are what your CleanerCard should call on clicks.
 */
export function recordEventBeacon({
  cleanerId,
  areaId,
  event,
  sessionId,
  categoryId,
  meta,
}: RecordEventArgs) {
  const sid = sessionId ?? getOrCreateSessionId();

  // If missing areaId, we still attempt (your SQL can store null area_id)
  const payload: any = {
    p_cleaner_id: cleanerId,
    p_area_id: areaId ?? null,
    p_event: event,
    p_session_id: sid,
    p_meta: meta ?? {},
    p_category_id: categoryId ?? null,
  };

  // fire-and-forget
  void rpcKeepalive("record_event", payload);
}

/**
 * ✅ Point-based "beacon" version (fire-and-forget, keepalive)
 */
export function recordEventFromPointBeacon({
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

  void rpcKeepalive("record_event_from_point", payload);
}
