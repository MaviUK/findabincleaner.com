// src/lib/analytics.ts
import { supabase } from "./supabase";

export type EventName =
  | "impression"
  | "click_message"
  | "click_website"
  | "click_phone";

/** Keep a fresh access token if the user is logged in (nice-to-have). */
let ACCESS_TOKEN: string | null = null;
void supabase.auth.getSession().then(({ data }) => {
  ACCESS_TOKEN = data.session?.access_token ?? null;
});
supabase.auth.onAuthStateChange((_e, session) => {
  ACCESS_TOKEN = session?.access_token ?? null;
});

/* -------------------------------------------------------------------------- */
/*  When you ALREADY know areaId                                              */
/* -------------------------------------------------------------------------- */

export async function recordEvent(params: {
  cleanerId: string;
  areaId: string | null;
  event: EventName;
  sessionId?: string;
  meta?: Record<string, any>;
}) {
  return sendRPCRecordEvent(params, /*keepalive*/ false);
}

export async function recordEventBeacon(params: {
  cleanerId: string;
  areaId: string | null;
  event: EventName;
  sessionId?: string;
  meta?: Record<string, any>;
}) {
  return sendRPCRecordEvent(params, /*keepalive*/ true);
}

async function sendRPCRecordEvent(
  {
    cleanerId,
    areaId,
    event,
    sessionId,
    meta,
  }: {
    cleanerId: string;
    areaId: string | null;
    event: EventName;
    sessionId?: string;
    meta?: Record<string, any>;
  },
  keepalive: boolean
) {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/record_event`;
  const body = JSON.stringify({
    p_cleaner_id: cleanerId,
    p_area_id: areaId,
    p_event: event,
    p_session_id: sessionId ?? getOrCreateSessionId(),
    p_meta: meta ?? {},
  });

  return doFetch(url, body, keepalive);
}

/* -------------------------------------------------------------------------- */
/*  When you ONLY know lat/lng (DB computes area_id)                          */
/* -------------------------------------------------------------------------- */

export async function recordEventFromPoint(params: {
  cleanerId: string;
  lat: number;
  lng: number;
  event: EventName;
  sessionId?: string;
  meta?: Record<string, any>;
}) {
  return sendRPCRecordEventFromPoint(params, /*keepalive*/ false);
}

export async function recordEventFromPointBeacon(params: {
  cleanerId: string;
  lat: number;
  lng: number;
  event: EventName;
  sessionId?: string;
  meta?: Record<string, any>;
}) {
  return sendRPCRecordEventFromPoint(params, /*keepalive*/ true);
}

async function sendRPCRecordEventFromPoint(
  {
    cleanerId,
    lat,
    lng,
    event,
    sessionId,
    meta,
  }: {
    cleanerId: string;
    lat: number;
    lng: number;
    event: EventName;
    sessionId?: string;
    meta?: Record<string, any>;
  },
  keepalive: boolean
) {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/record_event_from_point`;
  const body = JSON.stringify({
    p_cleaner_id: cleanerId,
    p_lat: lat,
    p_lng: lng,
    p_event: event,
    p_session_id: sessionId ?? getOrCreateSessionId(),
    p_meta: meta ?? {},
  });

  return doFetch(url, body, keepalive);
}

/* -------------------------------------------------------------------------- */
/*  Shared low-level fetch with headers + keepalive                           */
/* -------------------------------------------------------------------------- */

function doFetch(url: string, body: string, keepalive: boolean) {
  // Use logged-in JWT if present; otherwise fall back to anon key.
  const auth = ACCESS_TOKEN ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${auth}`,
      Prefer: "return=minimal",
    },
    keepalive,
    body,
  }).catch(() => {
    // fire-and-forget: swallow network errors
  });
}

/* -------------------------------------------------------------------------- */
/*  Session helper                                                            */
/* -------------------------------------------------------------------------- */

export function getOrCreateSessionId(): string {
  const KEY = "nbg_session_id";
  try {
    let v = localStorage.getItem(KEY);
    if (!v) {
      v =
        (crypto as any)?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(KEY, v);
    }
    return v;
  } catch {
    return (
      (crypto as any)?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  }
}
