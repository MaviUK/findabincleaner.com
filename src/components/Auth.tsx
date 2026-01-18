import { useState } from "react";
import { supabase } from "../lib/supabase";

type Mode = "login" | "signup";

export default function Auth() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const google = async () => {
    setError(null); setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/#/dashboard" }
window.location.href = "/#/dashboard";
    });
    if (error) setError(error.message);
    setBusy(false);
  };

  const submit = async () => {
    setError(null); setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      window.location.href = "/dashboard";
    } catch (e: any) {
      setError(e.message || "Auth failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="max-w-md mx-auto p-6 border rounded-xl space-y-4">
      <h1 className="text-2xl font-bold">
        {mode === "signup" ? "Create your cleaner account" : "Log in"}
      </h1>

      <button className="w-full border rounded px-4 py-2" onClick={google} disabled={busy}>
        Continue with Google
      </button>

      <div className="text-center text-sm text-gray-500">or</div>

      <div className="space-y-2">
        <input className="w-full border rounded px-3 py-2" placeholder="Email"
               type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full border rounded px-3 py-2" placeholder="Password"
               type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="w-full bg-black text-white rounded px-4 py-2"
                onClick={submit} disabled={busy}>
          {mode === "signup" ? "Sign up" : "Log in"}
        </button>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      <div className="text-sm">
        {mode === "signup" ? (
          <>Already have an account? <button className="underline" onClick={() => setMode("login")}>Log in</button></>
        ) : (
          <>New cleaner? <button className="underline" onClick={() => setMode("signup")}>Create account</button></>
        )}
      </div>
    </div>
  );
}
