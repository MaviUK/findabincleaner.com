import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function LogoutButton({ className = "" }: { className?: string }) {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    if (loading) return;
    setLoading(true);
    try {
      // sign out from Supabase
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      // optional: clear any of your app's cached state here
      // localStorage.removeItem("whatever");

      // send them to login (or landing)
      navigate("/login", { replace: true });
    } catch (e) {
      console.error(e);
      alert("Could not log out. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2 font-medium border
                  border-gray-200 hover:bg-gray-50 disabled:opacity-60 ${className}`}
      aria-label="Log out"
    >
      {loading ? "Logging out…" : "Log out"}
    </button>
  );
}
