// src/components/Layout.tsx
import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

const Layout: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [authed, setAuthed] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (mounted) setAuthed(!!session?.user);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setAuthed(!!s?.user);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const ctaHref = authed ? "/dashboard" : "/login?mode=signup";
  const ctaLabel = authed ? "Dashboard" : "Register a Business";
  const hideCta = location.pathname === "/login";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="font-bold">Find a Bin Cleaner</Link>

          {!hideCta && (
            <Link
              to={ctaHref}
              className="inline-flex items-center rounded-lg px-3 py-2 bg-emerald-700 text-white hover:bg-emerald-800"
            >
              {ctaLabel}
            </Link>
          )}
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t">
        <div className="container mx-auto px-4 py-6 flex items-center justify-between text-sm text-gray-500">
          <span>© {new Date().getFullYear()} Find a Bin Cleaner</span>
          <span>
            Built with <span className="text-rose-600">❤</span>
          </span>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
