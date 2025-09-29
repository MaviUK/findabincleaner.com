import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const TERMS_VERSION = "2025-09-29";

export default function Onboarding() {
  const nav = useNavigate();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // If already accepted, bounce to settings
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { nav("/login", { replace: true }); return; }

      const { data: me, error } = await supabase
        .from("cleaners")
        .select("id, terms_accepted, terms_version")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (error) {
        console.error("fetch cleaner failed", error);
        return;
      }
      if (me?.terms_accepted && me.terms_version === TERMS_VERSION) {
        nav("/settings", { replace: true });
      }
    })();
  }, [nav]);

  async function accept() {
    try {
      setSaving(true);
      setErr(null);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not signed in.");

      // Ensure a cleaners row exists for this user
      let cleanerId: string | null = null;
      {
        const { data: row, error } = await supabase
          .from("cleaners")
          .select("id")
          .eq("user_id", session.user.id)
          .maybeSingle();
        if (error) throw error;

        if (row?.id) {
          cleanerId = row.id;
        } else {
          const { data: created, error: insErr } = await supabase
            .from("cleaners")
            .insert({ user_id: session.user.id, business_name: null })
            .select("id")
            .single();
          if (insErr) throw insErr;
          cleanerId = created.id;
        }
      }

      const { error: updErr } = await supabase
        .from("cleaners")
        .update({
          terms_accepted: true,
          terms_version: TERMS_VERSION,
          terms_accepted_at: new Date().toISOString(),
          // Optionally auto-publish on accept:
          // is_published: true,
        })
        .eq("id", cleanerId!);

      if (updErr) throw updErr;

      nav("/settings", { replace: true });
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Could not save acceptance.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="container mx-auto max-w-2xl px-4 py-10 space-y-6">
      <h1 className="text-2xl font-bold">Terms & Conditions</h1>

      <div className="prose max-w-none border rounded p-4 bg-white">
        <p>
          By continuing you agree to the Find a Bin Cleaner Business Terms & Conditions (v{TERMS_VERSION}).
        </p>
        <a href="/#/terms" className="text-emerald-700 underline">Read the full Terms</a>
      </div>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span>I have read and agree to the Business Terms & Conditions.</span>
      </label>

      {err && <div className="text-sm text-red-700">{err}</div>}

      <button
        disabled={!checked || saving}
        onClick={accept}
        className="rounded-lg px-4 py-2 bg-emerald-700 text-white disabled:opacity-60"
      >
        {saving ? "Saving…" : "Agree & continue"}
      </button>
    </main>
  );
}
