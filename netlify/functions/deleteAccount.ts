// helper: run a delete and ignore "missing table" or "no rows" errors
const runSafe = async (p: Promise<any>) => {
  const { error } = await p;
  if (!error) return;
  // ignore: no rows / table missing / schema cache
  const msg = String(error.message || "");
  if (
    error.code === "PGRST116" ||              // no rows matched
    error.code === "42P01" ||                 // undefined_table
    /schema cache/i.test(msg) ||              // "Could not find the table ... in the schema cache"
    /does not exist/i.test(msg)
  ) {
    return;
  }
  throw error;
};

// collect cleaner ids (some child tables key off this)
const { data: cleanerIds } = await admin
  .from("cleaners")
  .select("id")
  .eq("user_id", userId);
const cleanerIdList = (cleanerIds ?? []).map((r: any) => r.id);

// === DELETE app data (adjust to *your* schema as needed) ===
// Only include tables you actually have. Missing tables will be ignored by runSafe().
await runSafe(admin.from("messages").delete().eq("user_id", userId));
await runSafe(admin.from("leads").delete().eq("user_id", userId));
await runSafe(admin.from("service_areas").delete().eq("user_id", userId));
if (cleanerIdList.length > 0) {
  await runSafe(admin.from("cleaner_ratings").delete().in("cleaner_id", cleanerIdList));
}
await runSafe(admin.from("cleaners").delete().eq("user_id", userId));
await runSafe(admin.from("profiles").delete().eq("id", userId)); // only if you have this table
