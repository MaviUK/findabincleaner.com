// src/components/Layout.tsx
import React from "react";
import { Link, NavLink } from "react-router-dom";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="font-bold">Find a Bin Cleaner</Link>
          <nav className="flex items-center gap-6 text-sm">
            <NavLink to="/dashboard">Dashboard</NavLink>
            <NavLink to="/settings">Profile</NavLink>
          </nav>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t">
        <div className="container mx-auto px-4 py-6 flex items-center justify-between text-sm text-gray-500">
          <span>© {new Date().getFullYear()} Find a Bin Cleaner</span>
          <span>Built with <span className="text-rose-600">❤</span></span>
        </div>
      </footer>
    </div>
  );
}
