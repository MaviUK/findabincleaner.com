// src/pages/CleanerProfile.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import ServicesMenu from "../components/ServicesMenu";
import LogoutButton from "../components/LogoutButton";

export default function CleanerProfile() {
  const [cleanerId, setCleanerId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    (async () => {
      // Ensure user is logged in; bounce to /login if not
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;

      if (!session?.user) {
        navigate("/login", { replace: true });
        return;
      }

      // Look up this user's cleaner record
      const { data, error } = await supabase
        .from("cleaners")
        .select("id")
        .eq("user_id", session.user.id)
        .single();

      if (error) {
        console.error("Failed to fetch cleaner id:", error);
      }

      if (!mounted) return;
      setCleanerId(data?.id ?? null);
      setReady(true);
    })();

    // keep in sync with auth changes
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) navigate("/login", { replace: true });
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  if (!ready) {
    // Optional: a lightweight placeholder to avoid layout shift
    return (
      <div className="p-6">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Profile</h1>
          <div className="h-9 w-24 rounded-xl bg-gray-100" />
        </header>
        <div className="h-40 rounded-2xl border border-gray-200 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Profile</h1>
        <LogoutButton />
      </header>

      {cleanerId ? (
        <ServicesMenu cleanerId={cleanerId} />
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          We couldn’t find a cleaner profile linked to your account yet.
          If you just signed up, try refreshing. Otherwise, complete your
          onboarding in <span className="font-medium">Settings</span>.
        </div>
      )}
    </div>
  );
}
