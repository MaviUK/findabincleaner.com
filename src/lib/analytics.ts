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
 * Writes via area-based RPC.
 * ✅ Allow areaId to be null — RPC can store it as null.
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

  const payload: any = {
    p_cleaner_id: cleanerId,
    p_area_id: areaId ?? null,
    p_event: event,
    p_session_id: sid,
    p_meta: meta ?? {},
    p_category_id: categoryId ?? null,
  };

  const { error } = await supabase.rpc("record_event", payload);
  if (error) throw error;
}

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

  const { error } = await supabase.rpc("record_event_from_point", payload);
  if (error) throw error;
}

export async function recordEventBeacon(args: RecordEventArgs) {
  return recordEvent(args);
}

export async function recordEventFromPoint(args: RecordEventFromPointArgs) {
  return recordEventFromPointBeacon(args);
}
