import { Link } from "react-router-dom";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-50">
      <Header />
      <main className="container mx-auto max-w-6xl px-4 sm:px-6 py-8">
        {children}
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="bg-white border-b border-ink-100">
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center gap-4">
        <Link to="/" className="text-xl font-semibold tracking-tight text-ink-900">
          Find a Bin Cleaner
        </Link>

        <nav className="ml-auto flex items-center gap-2 sm:gap-3">
          <Link className="btn btn-ghost" to="/dashboard">Dashboard</Link>
          <Link className="btn btn-ghost" to="/settings">Profile</Link>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-ink-100 bg-white">
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="muted">© {new Date().getFullYear()} Find a Bin Cleaner</p>
        <div className="muted">Built with ❤️</div>
      </div>
    </footer>
  );
}
