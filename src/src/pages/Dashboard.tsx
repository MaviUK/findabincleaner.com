import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import ServiceAreaEditor from "../components/ServiceAreaEditor";

export default function Dashboard() {
  const [status, setStatus] = useState<string | null>(null);
  const [cleanerId, setCleanerId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // You can redirect to login here
        return;
      }

      // Ensure cleaner row exists
      const { data: existing } = await supabase
        .from("cleaners")
        .select("id, subscription_status")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!existing) {
        const { data: created } = await supabase
          .from("cleaners")
          .insert({ user_id: user.id, business_name: user.email || "My Cleaning" })
          .select("id, subscription_status")
          .single();

        setCleanerId(created?.id || null);
        setStatus(created?.subscription_status || "incomplete");
      } else {
        setCleanerId(existing.id);
        setStatus(existing.subscription_status);
      }
    })();
  }, []);

  if (!status) return <div className="p-6">Loading…</div>;

  if (status !== "active") {
    return (
      <div className="p-6">
        <p>Your subscription is <b>{status}</b>.</p>
        <a className="btn" href="/subscribe">Activate subscription</a>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h2 className="text-xl mb-4">Your Service Areas</h2>
      {cleanerId && <ServiceAreaEditor cleanerId={cleanerId} />}
    </div>
  );
}
