// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error(
    "Supabase env vars are missing. Did you set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY?"
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // important for OAuth redirects
  },
});

// Expose in the browser console for debugging (optional)
if (typeof window !== "undefined") {
  (window as any).__sb = supabase;
}
