// netlify/functions/deleteAccount.ts
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// REQUIRED env vars in Netlify (Site settings → Environment variables):
// - SUPABASE_URL
// - SUPABASE_ANON_KEY
// - SUPABASE_SERVICE_ROLE   (server-side only; NEVER exposed to browser)
// - SUPABASE_STORAGE_LOGO_BUCKET (optional; defaults to "logos")

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!;
const LOGO_BUCKET = process.env.SUPABASE_STORAGE_LOGO_BUCKET ?? "logos";

/**
 * Delete every object under a prefix in a Supabase Storage bucket.
 * Uses offset pagination since .list() caps results.
 */
async function deleteBucketPrefix(
  bucket: string,
  prefix: string,
  admin: ReturnType<typeof createClient>
) {
  let offset = 0;
  const limit = 100;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: files, error } = await admin.storage
      .from(bucket)
      .list(prefix, { limit, offset, sortBy: { column: "name", order: "asc" } });

    if (error) throw error;
    if (!files || files.length === 0) break;

    const paths = files.map((f) => `${prefix}/${f.name}`);
    const { error: rmErr } = await admin.storage.from(bucket).remove(paths);
    if (rmErr) throw rmErr;

    offset += files.length;
    if (files.length < limit) break;
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // 1) Verify caller with the user's session token sent as Bearer
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return { statusCode: 401, body: "Missing Bearer token" };
    }
    const accessToken = authHeader.slice("Bearer ".length);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return { statusCode: 401, body: "Invalid or expired session" };
    }
    const userId = user.id;

    // 2) Use service role client for privileged deletes
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // 3) Delete app data (adjust table names/owner columns to your schema if needed)
    // If you already use ON DELETE CASCADE, some of these will be no-ops.
    // Ignore "no rows" errors safely.
    const swallowNoRows = async (p: Promise<any>) => {
      const { error } = await p;
      if (error && error.code !== "PGRST116") throw error; // PGRST116 = no rows matched
    };

    // Get cleaner ids owned by this user (for child tables keyed by cleaner_id)
    const { data: cleanerIds } = await admin
      .from("cleaners")
      .select("id")
      .eq("owner_id", userId);

    const cleanerIdList = (cleanerIds ?? []).map((r: any) => r.id);

    await swallowNoRows(admin.from("standee_claims").delete().eq("owner_id", userId));
    await swallowNoRows(admin.from("messages").delete().eq("owner_id", userId));
    await swallowNoRows(admin.from("leads").delete().eq("owner_id", userId));
    await swallowNoRows(admin.from("service_areas").delete().eq("owner_id", userId));
    if (cleanerIdList.length > 0) {
      await swallowNoRows(
        admin.from("cleaner_ratings").delete().in("cleaner_id", cleanerIdList)
      );
    }
    await swallowNoRows(admin.from("cleaners").delete().eq("owner_id", userId));
    await swallowNoRows(admin.from("profiles").delete().eq("id", userId)); // if you mirror auth users

    // 4) Delete storage assets (best-effort)
    try {
      await deleteBucketPrefix(LOGO_BUCKET, userId, admin); // expects files under logos/{userId}/...
    } catch {
      // ignore storage failures
    }

    // 5) Delete the Auth user
    const { error: delUserErr } = await admin.auth.admin.deleteUser(userId);
    if (delUserErr) throw delUserErr;

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err: any) {
    console.error("deleteAccount error", err);
    return { statusCode: 500, body: `Delete failed: ${err?.message || err}` };
  }
};
