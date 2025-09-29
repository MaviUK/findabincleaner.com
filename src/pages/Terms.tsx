// pages/Terms.tsx (or wherever your T&Cs live)
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";

async function onAgree(userId: string, termsVersion: string) {
  await supabase
    .from("profiles")
    .update({
      terms_version: termsVersion,
      terms_accepted_at: new Date().toISOString(),
    })
    .eq("id", userId);

  // do NOT create/ensure a cleaners row here
  // Send them to Settings to complete their profile
  navigate("/settings?firstRun=1");
}
