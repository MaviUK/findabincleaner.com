import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Find a Bin Cleaner</h1>
      <p className="mb-4 text-sm">
        This is the landing page. Try the debug route: <Link className="underline" to="/_debug">/_debug</Link>
      </p>
      <p><Link className="underline" to="/dashboard">Go to dashboard</Link></p>
    </div>
  );
}
