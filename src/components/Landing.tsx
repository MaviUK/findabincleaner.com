// src/pages/Landing.tsx
import { Link } from "react-router-dom";
import FindCleaners from "../components/FindCleaners";

export default function Landing() {
  return (
    <main className="w-full">
      <section className="container mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-4xl font-extrabold tracking-tight">
          Book a trusted wheelie bin cleaner in minutes
        </h1>
        <p className="text-gray-600">
          Compare local cleaners, check service areas and book online. Clean bins, happy homes.
        </p>

        <div className="flex gap-3 mt-4">
          <Link to="/login" className="bg-emerald-700 text-white px-4 py-2 rounded">
            I’m a cleaner
          </Link>
          <Link to="/" className="border px-4 py-2 rounded">Find cleaners</Link>
        </div>

        <div className="mt-6">
          <FindCleaners />
        </div>

        <p className="mt-4 text-sm text-gray-500">
          Free listing for cleaners • No signup fees
        </p>
      </section>
    </main>
  );
}
