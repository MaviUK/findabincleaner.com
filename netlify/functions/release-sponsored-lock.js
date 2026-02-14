import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) throw new Error("Missing Supabase admin env vars");
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true }, 200);
    if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

    const body = await req.json().catch(() => null);
    const lockId = String(body?.lock_id || body?.lockId || "").trim();
    if (!lockId) return json({ ok: false, error: "Missing lock_id" }, 400);

    const sb = getSupabaseAdmin();

    const { error } = await sb
      .from("sponsored_locks")
      .update({ is_active: false, expires_at: new Date().toISOString() })
      .eq("id", lockId);

    if (error) throw error;

    return json({ ok: true });
  } catch (e) {
    console.error("[release-sponsored-lock] error:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
