// netlify/functions/deleteAccount.ts


// 2) Use service role for privileged deletes
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
auth: { persistSession: false },
});


// ---- OPTIONAL: read business info for double‑check
// const { data: cleaner, error: cleanerErr } = await admin
// .from("cleaners")
// .select("id, business_name")
// .eq("owner_id", userId)
// .maybeSingle();


// 3) Delete app data. Adjust table names/columns to your schema.
// Prefer ON DELETE CASCADE FKs; this is a defensive cleanup order.


// Example tables you likely have:
// - service_areas (owner_id)
// - cleaners (owner_id)
// - cleaner_ratings (cleaner_id references cleaners.id)
// - standee_location / standee_claims (owner_id / cleaner_id)
// - messages / leads (cleaner_id)


// Delete child tables first if not using CASCADE
const deletions = [
admin.from("standee_claims").delete().eq("owner_id", userId),
admin.from("messages").delete().eq("owner_id", userId),
admin.from("leads").delete().eq("owner_id", userId),
admin.from("service_areas").delete().eq("owner_id", userId),
admin.from("cleaner_ratings").delete().in(
"cleaner_id",
(await admin.from("cleaners").select("id").eq("owner_id", userId)).data?.map((r: any) => r.id) || []
),
admin.from("cleaners").delete().eq("owner_id", userId),
admin.from("profiles").delete().eq("id", userId), // if you keep a profiles table mirroring auth
];


for (const op of deletions) {
const { error } = await op;
if (error && error.code !== "PGRST116") {
// PGRST116 = no rows matched; ignore
throw error;
}
}


// 4) Delete Storage assets (e.g., logos under `${userId}/`)
try {
await deleteBucketPrefix(LOGO_BUCKET, userId, admin);
} catch (_) {
// swallow — storage is best‑effort
}


// 5) Finally, delete the Auth user
const { error: delUserErr } = await admin.auth.admin.deleteUser(userId);
if (delUserErr) throw delUserErr;


return {
statusCode: 200,
body: JSON.stringify({ ok: true }),
headers: { "content-type": "application/json" },
};
} catch (err: any) {
console.error("deleteAccount error", err);
return { statusCode: 500, body: `Delete failed: ${err?.message || err}` };
}
};
