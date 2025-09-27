// src/pages/Dashboard.tsx
import React from "react";

export default function Dashboard() {
  return (
    <main className="container mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8">
      <h1 className="text-2xl font-bold">Cleaner Dashboard</h1>

      {/* Profile card */}
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4">
          {/* Logo */}
          <img
            src="/logo-192.png" /* replace with your logo URL */
            alt="Business logo"
            className="h-14 w-14 rounded-lg object-cover bg-white border"
          />

          {/* Name + address */}
          <div className="min-w-0">
            <div className="font-semibold truncate">Ni Bin Guy</div>
            <div className="text-sm text-gray-600 truncate">
              78 Groomsport Rd, Bangor BT20 5NF, UK
            </div>
          </div>

          {/* Action */}
          <button className="ml-auto inline-flex items-center px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700">
            Edit profile
          </button>
        </div>
      </section>

      {/* Service areas */}
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Your Service Areas</h2>
          <button className="inline-flex items-center px-3 py-2 rounded-xl bg-black text-white hover:opacity-90">
            New Area
          </button>
        </div>

        {/* Two-column layout: fixed left, fluid right */}
        <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-6 items-start">
          {/* LEFT: Area list */}
          <div className="space-y-3">
            {/* Replace with your real list */}
            <button className="w-full text-left p-4 rounded-xl border hover:bg-gray-50">
              <div className="font-medium">Crumlin</div>
              <div className="text-xs text-gray-500">Created 27/09/2025, 01:11:21</div>
            </button>
            <button className="w-full text-left p-4 rounded-xl border hover:bg-gray-50">
              <div className="font-medium">Carryduff</div>
              <div className="text-xs text-gray-500">Created 26/09/2025, 23:26:31</div>
            </button>
            <button className="w-full text-left p-4 rounded-xl border hover:bg-gray-50">
              <div className="font-medium">All Areas</div>
              <div className="text-xs text-gray-500">Created 26/09/2025, 22:37:21</div>
            </button>
          </div>

          {/* RIGHT: Map/editor */}
          <div className="rounded-xl overflow-hidden border">
            {/* Make the map a fixed, tidy height */}
            <div className="h-[460px]">
              {/* Mount your Google map / ServiceAreaEditor component here */}
              {/* <ServiceAreaEditor /> */}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
