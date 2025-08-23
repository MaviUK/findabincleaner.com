import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import CleanerOnboard from "../components/CleanerOnboard";
import ServiceAreaEditor from "../components/ServiceAreaEditor";

type Cleaner = {
  id: string; user_id: string;
  business_name: string | null; logo_url: string | null; address: string | null;
  subscription_status: "active" | "incomplete" | "past_due" | "canceled" | null;
};

export default function Dashboard() {
  const [userId, setUserId] = useState<string | null>(null);
  const [cleaner, setCleaner] = useState<Cleaner | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }
      setUserId(user.id);

      const { data: existing } = await supabase
        .from("cleaners")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!existing) {
        const { data: created } = await supabase.from("cleaners")
          .insert({
            user_id: user.id,
            business_name: user.email?.split("@")[0] || "My Bin Cleaning",
            subscription_status: "active", // FREE mode
          })
          .select("*").single();
        setCleaner(created as Cleaner);
      } else {
        setCleaner(existing as Cleaner);
      }
      setLoading(false);
    })();
  }, []);

  if (loading || !userId || !cleaner) return <div className="p-6">Loading…</div>;

  const needsOnboard = !cleaner.business_name || !cleaner.address || !cleaner.logo_url;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Cleaner Dashboard</h1>

      {needsOnboard ? (
        <CleanerOnboard
          userId={userId}
          cleaner={cleaner}
          onSaved={(patch) => setCleaner(prev => (prev ? { ...prev, ...patch } as Cleaner : prev))}
        />
      ) : (
        <>
          {/* Profile summary + edit link */}
          <div className="p-4 border rounded-xl flex items-center gap-4">
            {cleaner.logo_url ? (
              <img src={cleaner.logo_url} alt="logo" className="h-14 w-14 object-contain rounded" />
            ) : (
              <div className="h-14 w-14 bg-gray-200 rounded" />
            )}
            <div className="flex-1">
              <div className="font-semibold">{cleaner.business_name}</div>
              <div className="text-sm text-gray-600">{cleaner.address || "No address yet"}</div>
            </div>
            <a href="/settings" className="bg-black text-white px-3 py-2 rounded">Edit profile</a>
          </div>

          <h2 className="text-xl font-semibold">Your Service Areas</h2>
          <ServiceAreaEditor cleanerId={cleaner.id} />
        </>
      )}
    </div>
  );
}
