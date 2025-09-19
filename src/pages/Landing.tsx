import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import FindCleaners from "../components/FindCleaners";

export default function Landing() {
  const [isAuthed, setIsAuthed] = useState<boolean>(false);

  useEffect(() => {
    // check once on mount
    supabase.auth.getUser().then(({ data: { user } }) => setIsAuthed(!!user));
    // keep in sync if they log in/out without leaving the page
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setIsAuthed(!!session?.user);
    });
    return () => sub?.subscription.unsubscribe();
  }, []);

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Find a Bin Cleaner</h1>

        {/* Cleaner CTA */}
        {isAuthed ? (
          <a
            href="/dashboard"
            className="bg-black text-white px-4 py-2 rounded"
          >
            Go to dashboard
          </a>
        ) : (
          <a
            href="/login?as=cleaner"
            className="bg-black text-white px-4 py-2 rounded"
          >
            I’m a cleaner — List my business
          </a>
        )}
      </header>

      {/* Customer search */}
      <FindCleaners />

      {/* Secondary cleaner prompt for visibility */}
      {!isAuthed && (
        <div className="text-sm text-gray-600">
          Are you a bin cleaner?{" "}
          <a href="/login?as=cleaner" className="underline">
            Create a free listing
          </a>{" "}
          to appear in searches.
        </div>
      )}
    </div>
  );
}
