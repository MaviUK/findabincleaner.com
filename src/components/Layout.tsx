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

  const hideCta = location.pathname === "/login";

  // ✅ One wrapper used everywhere (header + footer should match body rails)
  const WRAP = "mx-auto w-full max-w-7xl px-4 sm:px-6";

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-black/5 bg-white/80 backdrop-blur">
        <div className={`${WRAP} h-16 flex items-center justify-between`}>
          <Link to="/" className="inline-flex items-center gap-3">
            <img
              src="/cleanlylogo.png"
              alt="Klean.ly"
              className="h-16 w-16 object-contain"
              draggable={false}
            />
            <span className="font-extrabold tracking-tight text-gray-900 text-lg">
              Klean<span className="text-emerald-600">.</span>ly
            </span>
          </Link>

          {!hideCta && (
            <div className="flex items-center gap-3">
              {authed ? (
                <>
                  <Link
                    to="/dashboard"
                    className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold
                               bg-gray-900 text-white hover:bg-black
                               focus:outline-none focus:ring-4 focus:ring-black/20"
                  >
                    Dashboard
                  </Link>

                  <button
                    type="button"
                    onClick={handleLogout}
                    className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold
                               border border-gray-300 text-gray-700 hover:bg-gray-100
                               focus:outline-none focus:ring-4 focus:ring-black/10"
                  >
                    Log out
                  </button>
                </>
              ) : (
                <Link
                  to="/login?mode=signup"
                  className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold
                             bg-gray-900 text-white hover:bg-black
                             focus:outline-none focus:ring-4 focus:ring-black/20"
                >
                  Register a Business
                </Link>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Page */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="border-t border-black/5 bg-white">
        <div
          className={`${WRAP} py-6 flex flex-col sm:flex-row gap-2 sm:gap-0 items-center justify-between text-sm text-gray-500`}
        >
          <span>© {new Date().getFullYear()} Klean.ly</span>
          <span>
            Built with <span className="text-rose-600">❤</span>
          </span>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
