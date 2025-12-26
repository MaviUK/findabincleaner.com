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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (mounted) setAuthed(!!session?.user);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setAuthed(!!s?.user);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const ctaHref = authed ? "/dashboard" : "/login?mode=signup";
  const ctaLabel = authed ? "Dashboard" : "Register a Business";
  const hideCta = location.pathname === "/login";

  // ✅ Single source of truth for horizontal alignment
  // Use this exact wrapper everywhere you want perfect "rails"
  const WRAP = "mx-auto w-full max-w-7xl px-4 sm:px-6";

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-black/5 bg-white/80 backdrop-blur">
        <div className={`${WRAP} h-16 flex items-center justify-between`}>
          {/* Left */}
          <Link to="/" className="inline-flex items-center gap-3">
            <img
              src="/cleanlylogo.png"
              alt="Clean.ly"
              className="h-8 w-8 object-contain"
              draggable={false}
            />
            <span className="font-extrabold tracking-tight text-gray-900 text-lg">
              Clean<span className="text-emerald-600">.</span>ly
            </span>
          </Link>

          {/* Right */}
          {!hideCta && (
            <Link
              to={ctaHref}
              className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold
                         bg-gray-900 text-white hover:bg-black
                         focus:outline-none focus:ring-4 focus:ring-black/20"
            >
              {ctaLabel}
            </Link>
          )}
        </div>
      </header>

      {/* Page */}
      <div className="flex-1">{children}</div>

      {/* Footer */}
      <footer className="border-t border-black/5 bg-white">
        <div
          className={`${WRAP} py-6 flex flex-col sm:flex-row gap-2 sm:gap-0 items-center justify-between text-sm text-gray-500`}
        >
          <span>© {new Date().getFullYear()} Clean.ly</span>
          <span>
            Built with <span className="text-rose-600">❤</span>
          </span>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
