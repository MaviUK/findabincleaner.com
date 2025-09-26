// e.g. src/pages/CleanerProfile.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import ServicesMenu from "../components/ServicesMenu";

export default function CleanerProfile() {
  const [cleanerId, setCleanerId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("cleaners")
        .select("id")
        .eq("user_id", user.id)
        .single();
      setCleanerId(data?.id ?? null);
    })();
  }, []);

  if (!cleanerId) return null;

  return (
    <div className="p-6">
      <ServicesMenu cleanerId={cleanerId} />
    </div>
  );
}
