// src/pages/Login.tsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const defaultTab = params.get("mode") === "signup" ? "signup" : "login";

  const [tab, setTab] = useState<"login" | "signup">(defaultTab);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<null | "google">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // If already signed in, go straight to Dashboard
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) navigate("/dashboard", { replace: true });
    })();
  }, [navigate]);

  // Handle the moment OAuth (or any auth) completes
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) navigate("/dashboard", { replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const title = useMemo(
    () => (tab === "signup" ? "Create a business account" : "Log in"),
    [tab]
  );

  async function handleLogin() {
    setLoading(true); setErr(null); setMsg(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.session) navigate("/dashboard", { replace: true });
    } catch (e: any) {
      setErr(e.message || "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup() {
    setLoading(true); setErr(null); setMsg(null);
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        setMsg("Check your email to confirm your account, then log in.");
      } else {
        navigate("/dashboard", { replace: true });
      }
    } catch (e: any) {
      setErr(e.message || "Signup failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    try {
      setErr(null);
      setOauthLoading("google");
      // With HashRouter, keep redirectTo on the origin (no '#/...' to avoid double-hash)
      const redirectTo = `${window.location.origin}/`;
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
    } catch (e: any) {
      setErr(e.message || "Google sign-in failed.");
      setOauthLoading(null);
    }
  }

  return (
    <main className="container mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-bold mb-4">{title}</h1>

      {/* Tabs */}
      <div className="mb-4 inline-flex rounded-lg border overflow-hidden">
        <button
          className={`px-4 py-2 text-sm ${tab === "login" ? "bg-black text-white" : "bg-white"}`}
          onClick={() => setTab("login")}
        >
          Log in
        </button>
        <button
          className={`px-4 py-2 text-sm ${tab === "signup" ? "bg-black text-white" : "bg-white"}`}
          onClick={() => setTab("signup")}
        >
          Create account
        </button>
      </div>

      {/* Form */}
      <div className="space-y-3">
        <label className="block">
          <span className="text-sm">Email</span>
          <input
            type="email"
            className="mt-1 w-full border rounded px-3 py-2"
            placeholder="you@business.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>

        <label className="block">
          <span className="text-sm">Password</span>
          <input
            type="password"
            className="mt-1 w-full border rounded px-3 py-2"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={tab === "login" ? "current-password" : "new-password"}
          />
        </label>

        {err && <div className="text-sm text-red-700">{err}</div>}
        {msg && <div className="text-sm text-emerald-700">{msg}</div>}

        {tab === "login" ? (
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full rounded-lg bg-emerald-700 text-white py-2 disabled:opacity-60"
          >
            {loading ? "Logging in…" : "Log in"}
          </button>
        ) : (
          <button
            onClick={handleSignup}
            disabled={loading}
            className="w-full rounded-lg bg-emerald-700 text-white py-2 disabled:opacity-60"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        )}

        {/* Divider */}
        <div className="relative my-4">
          <div className="h-px bg-gray-200" />
          <span className="absolute inset-0 -top-2 mx-auto w-max bg-white px-2 text-xs text-gray-500">
            or
          </span>
        </div>

        {/* Google OAuth */}
        <button
          onClick={handleGoogle}
          disabled={oauthLoading === "google"}
          className="w-full rounded-lg border py-2 hover:bg-gray-50 disabled:opacity-60 inline-flex items-center justify-center gap-2"
          aria-label="Continue with Google"
        >
          {oauthLoading === "google" ? (
            "Connecting…"
          ) : (
            <>
              <svg viewBox="0 0 533.5 544.3" className="h-5 w-5" aria-hidden>
                <path fill="#4285f4" d="M533.5 278.4c0-18.6-1.7-37-5.1-54.7H272v103.6h146.9c-6.3 34-25 62.7-53.5 81.9v67h86.5c50.7-46.7 81.6-115.5 81.6-197.8z"/>
                <path fill="#34a853" d="M272 544.3c73.7 0 135.6-24.3 180.8-66.1l-86.5-67c-24 16.1-54.7 25.6-94.3 25.6-72.5 0-134-48.9-155.9-114.6H27.6v71.9C72.5 483.8 166.8 544.3 272 544.3z"/>
                <path fill="#fbbc04" d="M116.1 322.2c-10.4-31-10.4-64.5 0-95.5V154.8H27.6c-39.3 78.6-39.3 171.3 0 249.9l88.5-82.5z"/>
                <path fill="#ea4335" d="M272 107.7c39.9-.6 78.2 14.6 107.4 42.7l80.1-80.1C407.6 24.1 341.7-1.1 272 0 166.8 0 72.5 60.5 27.6 154.8l88.5 71.9C138 156.2 199.5 107.7 272 107.7z"/>
              </svg>
              Continue with Google
            </>
          )}
        </button>
      </div>
    </main>
  );
}
