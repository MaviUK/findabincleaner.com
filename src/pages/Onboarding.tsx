const TERMS_VERSION = "2025-09-29";

async function agreeToTerms() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // find their cleaner row (you already do similar in Settings)
  const { data: cleaner } = await supabase
    .from("cleaners")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  // if no row yet, create it now so we have somewhere to store flags
  let cleanerId = cleaner?.id;
  if (!cleanerId) {
    const { data: created, error } = await supabase
      .from("cleaners")
      .insert({ user_id: user.id, business_name: null })
      .select("id")
      .single();
    if (error) throw error;
    cleanerId = created!.id;
  }

  const { error: updErr } = await supabase
    .from("cleaners")
    .update({
      terms_accepted: true,
      terms_version: TERMS_VERSION,
      terms_accepted_at: new Date().toISOString(),
      // Optionally auto-publish once terms accepted:
      // is_published: true,
    })
    .eq("id", cleanerId);
  if (updErr) throw updErr;

  // continue to settings/dashboard
  window.location.hash = "#/settings";
}
