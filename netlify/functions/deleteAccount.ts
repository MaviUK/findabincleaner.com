// netlify/functions/deleteAccount.ts
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// Env (Functions/Runtime only; NEVER expose service role to client)
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!;
const LOGO_BUCKET = process.env.SUPABASE_STORAGE_LOGO_BUCKET ?? "logos";

// Delete every object under a prefix in a bucket
async function deleteBucketPrefix(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string
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
    // Verify caller (user session token sent as Bearer)
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

    // Admin client for privileged ops
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // Helper that ignores "no rows"/"table missing" errors
    const runSafe = async (p: Promise<any>) => {
      const { error } = await p;
      if (!error) return;
      const msg = String(error.message || "");
      if (
        error.code === "PGRST116" || // no rows matched
        error.code === "42P01" ||    // undefined_table
        /schema cache/i.test(msg) ||
        /does not exist/i.test(msg)
      ) {
        return;
      }
      throw error;
    };

    // Gather cleaner ids owned by this user (if any)
    const { data: cleanerRows } = await admin
      .from("cleaners")
      .select("id")
      .eq("user_id", userId);
    const cleanerIdList = (cleanerRows ?? []).map((r: any) => r.id);

    // Delete app data — adjust to your actual tables/owner columns
    await runSafe(admin.from("messages").delete().eq("user_id", userId));
    await runSafe(admin.from("leads").delete().eq("user_id", userId));
    await runSafe(admin.from("service_areas").delete().eq("user_id", userId));
    if (cleanerIdList.length > 0) {
      await runSafe(
        admin.from("cleaner_ratings").delete().in("cleaner_id", cleanerIdList)
      );
    }
    await runSafe(admin.from("cleaners").delete().eq("user_id", userId));
    await runSafe(admin.from("profiles").delete().eq("id", userId)); // only if you have this table

    // Storage (best-effort): delete everything under logos/{userId}/
    try {
      await deleteBucketPrefix(admin, LOGO_BUCKET, userId);
    } catch {
      /* ignore storage failures */
    }

    // Finally remove the Auth user
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
