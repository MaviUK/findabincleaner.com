// src/components/Layout.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

// ✅ import your legal pages (JSX is fine to import into TS)
import PrivacyPolicy from "../pages/PrivacyPolicy.jsx";
import TermsAndConditions from "../pages/TermsAndConditions.jsx";
import CookiePolicy from "../pages/CookiePolicy.jsx";
import SponsoredListingsDisclosure from "../pages/SponsoredListings.jsx";

type LegalKey = "privacy" | "terms" | "cookies" | "sponsored";

const Layout: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [authed, setAuthed] = useState(false);
  const location = useLocation();

  // ✅ legal modal state
  const [legalOpen, setLegalOpen] = useState<LegalKey | null>(null);

  const pages = useMemo(
    () => ({
      privacy: { title: "Privacy Policy", Component: PrivacyPolicy },
      terms: { title: "Terms & Conditions", Component: TermsAndConditions },
      cookies: { title: "Cookie Policy", Component: CookiePolicy },
      sponsored: { title: "Sponsored Listings", Component: SponsoredListingsDisclosure },
    }),
    []
  );

  const current = legalOpen ? pages[legalOpen] : null;
  const CurrentComponent = current?.Component;

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

  // ✅ close modal on ESC + lock body scroll
  useEffect(() => {
    if (!legalOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLegalOpen(null);
    };

    document.addEventListener("keydown", onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [legalOpen]);

  const hideCta = location.pathname === "/login";

  // ✅ One wrapper used everywhere (header + footer should match body rails)
  const WRAP = "mx-auto w-full max-w-7xl px-4 sm:px-6";

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const legalBtn =
    "cursor-pointer underline underline-offset-4 hover:text-gray-900";

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
        <div className={`${WRAP} py-6 text-sm text-gray-500`}>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-0 items-center justify-between">
            <span>© {new Date().getFullYear()} Klean.ly</span>
            <span>
              Built with <span className="text-rose-600">❤</span>
            </span>
          </div>

          {/* ✅ Legal links row */}
          <div className="mt-3 flex flex-wrap items-center justify-center sm:justify-start gap-x-3 gap-y-1">
            <button
              type="button"
              className={legalBtn}
              onClick={() => setLegalOpen("privacy")}
            >
              Privacy Policy
            </button>
            <span className="text-gray-300">|</span>

            <button
              type="button"
              className={legalBtn}
              onClick={() => setLegalOpen("terms")}
            >
              Terms &amp; Conditions
            </button>
            <span className="text-gray-300">|</span>

            <button
              type="button"
              className={legalBtn}
              onClick={() => setLegalOpen("cookies")}
            >
              Cookie Policy
            </button>
            <span className="text-gray-300">|</span>

            <button
              type="button"
              className={legalBtn}
              onClick={() => setLegalOpen("sponsored")}
            >
              Sponsored Listings
            </button>

            <span className="text-gray-300">|</span>

            <a
              className="underline underline-offset-4 hover:text-gray-900"
              href="mailto:hello@yourdomain.co.uk"
            >
              Contact
            </a>
          </div>

          {/* ✅ Directory disclaimer */}
          <div className="mt-3 text-xs text-gray-400 leading-relaxed">
            We operate as a business directory only and are not responsible for services provided by listed businesses.
          </div>
        </div>
      </footer>

      {/* ✅ Legal Modal */}
      {legalOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60"
          onMouseDown={() => setLegalOpen(null)}
        >
          <div
            className="w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-2xl bg-white shadow-2xl border border-black/10"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-black/10 bg-white">
              <div className="font-semibold text-gray-900">{current?.title}</div>
              <button
                type="button"
                onClick={() => setLegalOpen(null)}
                className="rounded-xl px-3 py-1.5 text-sm font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            {/* Modal body (scroll) */}
            <div className="overflow-auto max-h-[calc(88vh-52px)] bg-white">
              {/* Your JSX pages have their own <main> etc; they will render fine here */}
              {CurrentComponent ? <CurrentComponent /> : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Layout;
