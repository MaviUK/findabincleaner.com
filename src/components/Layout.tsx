// src/components/Layout.tsx
import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

type LegalTab = "terms" | "privacy" | "cookies" | "sponsored";

function openLegal(tab: LegalTab) {
  window.dispatchEvent(new CustomEvent("open-legal", { detail: { tab } }));
}

const Layout: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [authed, setAuthed] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);

  const [supportType, setSupportType] = useState<"user" | "business">("user");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportSending, setSupportSending] = useState(false);
  const [supportSent, setSupportSent] = useState<null | "ok" | "error">(null);

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

  const closeSupport = () => {
    setSupportOpen(false);
    // reset UI state after close (small delay so it doesn't flash)
    setTimeout(() => {
      setSupportSent(null);
      setSupportSending(false);
    }, 150);
  };

  const openSupport = () => {
    setSupportOpen(true);
    setSupportSent(null);

    // best-effort: prefill email from authed user (if available)
    supabase.auth.getUser().then(({ data }) => {
      const em = data?.user?.email;
      if (em && !supportEmail) setSupportEmail(em);
    });
  };

  const submitSupport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (supportSending) return;

    setSupportSending(true);
    setSupportSent(null);

    try {
      // ✅ TODO: wire this to your Netlify function
      // e.g. POST /.netlify/functions/sendSupportEmail
      // For now this just simulates a send.
      await new Promise((r) => setTimeout(r, 500));

      setSupportSent("ok");
      setSupportMessage("");
    } catch (err) {
      console.error(err);
      setSupportSent("error");
    } finally {
      setSupportSending(false);
    }
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
        <div className={`${WRAP} py-6`}>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-0 items-center justify-between text-sm text-gray-500">
            <span>© {new Date().getFullYear()} Klean.ly</span>
            <span>
              Built with <span className="text-rose-600">❤</span>
            </span>
          </div>

          {/* Legal links row */}
          <div className="mt-3 flex flex-wrap items-center justify-center sm:justify-between gap-x-4 gap-y-2 text-xs text-gray-500">
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
              <button
                type="button"
                onClick={() => openLegal("terms")}
                className="hover:text-gray-900 underline underline-offset-4 decoration-gray-300"
              >
                Terms
              </button>
              <button
                type="button"
                onClick={() => openLegal("privacy")}
                className="hover:text-gray-900 underline underline-offset-4 decoration-gray-300"
              >
                Privacy
              </button>
              <button
                type="button"
                onClick={() => openLegal("cookies")}
                className="hover:text-gray-900 underline underline-offset-4 decoration-gray-300"
              >
                Cookies
              </button>
              <button
                type="button"
                onClick={() => openLegal("sponsored")}
                className="hover:text-gray-900 underline underline-offset-4 decoration-gray-300"
              >
                Sponsored Listing Terms
              </button>
            </div>

            <div className="text-xs text-gray-500">
              Questions?{" "}
              <button
                type="button"
                onClick={openSupport}
                className="font-semibold text-gray-900 underline underline-offset-2 hover:opacity-80"
              >
                Contact support
              </button>
            </div>
          </div>
        </div>
      </footer>

      {/* Support modal */}
      {supportOpen && (
        <div className="fixed inset-0 z-[120]">
          <button
            className="absolute inset-0 bg-black/40"
            aria-label="Close support"
            onClick={closeSupport}
          />
          <div className="relative mx-auto mt-10 sm:mt-16 w-[min(640px,92vw)] rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
              <div>
                <div className="text-lg font-semibold text-gray-900">
                  Contact support
                </div>
                <div className="text-sm text-gray-500">
                  We’ll reply by email as soon as possible.
                </div>
              </div>
              <button
                onClick={closeSupport}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
              >
                Close
              </button>
            </div>

            <form
              className="px-5 py-5 space-y-4"
              onSubmit={submitSupport}
              autoComplete="on"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    I am a…
                  </label>
                  <select
                    value={supportType}
                    onChange={(e) =>
                      setSupportType(e.target.value as "user" | "business")
                    }
                    className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="user">User</option>
                    <option value="business">Business</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={supportEmail}
                    onChange={(e) => setSupportEmail(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Message
                </label>
                <textarea
                  required
                  rows={6}
                  value={supportMessage}
                  onChange={(e) => setSupportMessage(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                  placeholder="Tell us what’s going on…"
                />
              </div>

              {supportSent === "ok" && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  Thanks — your message has been sent.
                </div>
              )}

              {supportSent === "error" && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  Sorry — something went wrong. Please try again.
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeSupport}
                  className="w-full sm:w-auto rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={supportSending}
                  className="w-full sm:w-auto rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
                >
                  {supportSending ? "Sending…" : "Send"}
                </button>
              </div>

              <div className="text-xs text-gray-500">
                Tip: include your postcode (users) or business name (businesses)
                so we can help faster.
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Layout;
