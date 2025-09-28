import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const defaultTab = params.get("mode") === "signup" ? "signup" : "login";

  const [tab, setTab] = useState<"login" | "signup">(defaultTab as any);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // If already signed in, bounce to Settings
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) navigate("/settings", { replace: true });
    })();
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
      if (data.session) navigate("/settings", { replace: true });
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

      // If email confirmation is enabled, there is no session yet.
      if (!data.session) {
        setMsg("Check your email to confirm your account, then come back to log in.");
      } else {
        navigate("/settings", { replace: true });
      }
    } catch (e: any) {
      setErr(e.message || "Signup failed.");
    } finally {
      setLoading(false);
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

        <p className="text-sm text-center text-gray-600">
          {tab === "login" ? (
            <>
              New here?{" "}
              <button className="text-emerald-700 hover:underline" onClick={() => setTab("signup")}>
                Create a free business account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button className="text-emerald-700 hover:underline" onClick={() => setTab("login")}>
                Log in
              </button>
            </>
          )}
        </p>
      </div>

      {/* Optional OAuth example:
      <button
        onClick={async () => {
          await supabase.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: window.location.origin + "/#/settings" },
          });
        }}
        className="mt-4 w-full rounded-lg border py-2 hover:bg-gray-50"
      >
        Continue with Google
      </button>
      */}
    </main>
  );
}
