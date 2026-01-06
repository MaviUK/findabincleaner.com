// netlify/functions/_lib/supabase.js
// Centralised Supabase client creation for Netlify Functions.
// - Supports multiple env var names (older + newer)
// - Validates presence to avoid import-time crashes like "supabaseKey is required"

const { createClient } = require("@supabase/supabase-js");

function getSupabaseServiceRoleKey() {
  // Preferred (matches Netlify screenshot)
  const preferred = process.env.SUPABASE_SERVICE_ROLE;
  // Common alternates (older code / other repos)
  const alt1 = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const alt2 = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : undefined;
  const alt3 = process.env.SUPABASE_SERVICE_KEY;
  return preferred || alt1 || alt2 || alt3 || null;
}

function createSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = getSupabaseServiceRoleKey();

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE (service role key) in environment variables."
    );
  }

  return createClient(url, key);
}

// Lazy singleton so require() doesn't crash at import time.
let _client = null;
function getSupabaseAdmin() {
  if (_client) return _client;
  _client = createSupabaseAdminClient();
  return _client;
}

module.exports = {
  getSupabaseAdmin,
  getSupabaseServiceRoleKey,
};
