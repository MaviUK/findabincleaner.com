// src/pages/Invoices.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type InvoiceRow = {
  id: string;
  cleaner_id: string;
  area_id: string | null;
  stripe_invoice_id: string | null;
  stripe_payment_intent_id: string | null;
  invoice_number: string | null;
  status: string | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  currency: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  pdf_signed_url: string | null;
  hosted_invoice_url: string | null; // if you store this on invoices; safe if null
  invoice_pdf: string | null;        // if you store this on invoices; safe if null
  emailed_at: string | null;
  created_at: string | null;
};

function money(cents: number | null, currency: string | null) {
  const c = Number(cents || 0);
  const cur = (currency || "GBP").toUpperCase();
  // Your DB stores GBP/gbp mostly
  if (cur === "GBP") return `£${(c / 100).toFixed(2)}`;
  return `${cur} ${(c / 100).toFixed(2)}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

export default function Invoices() {
  const nav = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      setUser(data.user ?? null);
      setLoading(false);
      if (!data.user) nav("/login");
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) nav("/login");
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, [nav]);

  useEffect(() => {
    if (!user) return;

    (async () => {
      setError(null);

      // Find the cleaner/business row for this user
      const { data: cleaner, error: cErr } = await supabase
        .from("cleaners")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cErr) {
        setError(cErr.message);
        return;
      }
      if (!cleaner?.id) {
        setError("No business found for this account.");
        return;
      }

      const { data, error: invErr } = await supabase
        .from("invoices")
        .select(
          "id, cleaner_id, area_id, stripe_invoice_id, stripe_payment_intent_id, invoice_number, status, subtotal_cents, tax_cents, total_cents, currency, billing_period_start, billing_period_end, pdf_signed_url, hosted_invoice_url, invoice_pdf, emailed_at, created_at"
        )
        .eq("cleaner_id", cleaner.id)
        .order("created_at", { ascending: false });

      if (invErr) {
        setError(invErr.message);
        return;
      }

      setRows((data as InvoiceRow[]) || []);
    })();
  }, [user]);

  const totalCount = rows.length;

  const byStatus = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = (r.status || "unknown").toLowerCase();
      m.set(k, (m.get(k) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  if (loading) {
    return (
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-10">
        <div className="text-sm text-gray-600">Loading…</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <div className="mt-1 text-sm text-gray-600">
            Your invoice history ({totalCount})
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/dashboard"
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
          >
            Back to dashboard
          </Link>
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {!!byStatus.length && (
        <div className="mt-6 flex flex-wrap gap-2">
          {byStatus.map(([s, n]) => (
            <span
              key={s}
              className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
            >
              {s}: {n}
            </span>
          ))}
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Download</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => {
                const invNo = r.invoice_number || r.stripe_invoice_id || "—";
                const period =
                  r.billing_period_start || r.billing_period_end
                    ? `${fmtDate(r.billing_period_start)} → ${fmtDate(
                        r.billing_period_end
                      )}`
                    : "—";

                // Prefer signed PDF url if you store it; else fall back to Stripe-hosted links if present
                const downloadUrl =
                  r.pdf_signed_url || r.invoice_pdf || r.hosted_invoice_url || null;

                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {invNo}
                      {r.area_id ? (
                        <div className="mt-1 text-xs text-gray-500">
                          Area: {r.area_id}
                        </div>
                      ) : null}
                    </td>

                    <td className="px-4 py-3 text-gray-700">{period}</td>

                    <td className="px-4 py-3">
                      <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700">
                        {(r.status || "unknown").toUpperCase()}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-gray-900">
                      {money(r.total_cents, r.currency)}
                    </td>

                    <td className="px-4 py-3 text-gray-700">
                      {fmtDate(r.created_at)}
                    </td>

                    <td className="px-4 py-3 text-right">
                      {downloadUrl ? (
                        <a
                          href={downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs hover:bg-gray-50"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {!rows.length && !error && (
                <tr>
                  <td className="px-4 py-10 text-center text-gray-500" colSpan={6}>
                    No invoices found yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 text-xs text-gray-500">
        If “View” is blank, it means this invoice row doesn’t have a stored PDF URL yet.
      </div>
    </div>
  );
}
