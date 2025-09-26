import { Link } from "react-router-dom";

export default function Login() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Login</h1>
      <p className="mt-2 text-sm">
        (Stub) Replace with Supabase login. For now, go <Link className="underline" to="/dashboard">to dashboard</Link>.
      </p>
    </div>
  );
}
