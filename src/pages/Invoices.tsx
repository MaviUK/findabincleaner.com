// src/pages/Invoices.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

type InvoiceRow = {
  id: string;
  invoice_number: string | null;
  status: string | null;
  total_cents: number | null;
  currency: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  created_at: string;
  pdf_signed_url: string | null;
  pdf_url: string | null;
};

export default function Invoices() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<InvoiceRow[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          setError("Not signed in");
          setLoading(false);
          return;
        }

        // 🔑 get cleaner_id for this user
        const { data: cleaner, error: cleanerErr } = await supabase
          .from("cleaners")
          .select("id")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (cleanerErr || !cleaner) {
          setError("Cleaner record not found");
          setLoading(false);
          return;
        }

        // ✅ THIS IS THE QUERY YOU ASKED ABOUT
        const { data, error: invErr } = await supabase
          .from("invoices")
          .select(`
            id,
            invoice_number,
            status,
            total_cents,
            currency,
            billing_period_start,
            billing_period_end,
            created_at,
            pdf_signed_url,
            pdf_url
          `)
          .eq("cleaner_id", cleaner.id)
          .order("created_at", { ascending: false });

        if (invErr) {
          setError(invErr.message);
        } else {
          setRows(data || []);
        }
      } catch (e: any) {
        setError(e.message || "Failed to load invoices");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="section-title text-2xl">Invoices</h1>
        <Link to="/dashboard" className="btn">
          Back to dashboard
        </Link>
      </div>

      {loading && <div className="muted">Loading invoices…</div>}

      {error && (
        <div className="alert alert-error mb-4">
          {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="muted">No invoices yet.</div>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Status</th>
                <th>Total</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const total =
                  r.total_cents != null
                    ? (r.total_cents / 100).toFixed(2)
                    : "—";

                const pdf = r.pdf_signed_url || r.pdf_url;

                return (
                  <tr key={r.id}>
                    <td>{r.invoice_number || "—"}</td>
                    <td className="capitalize">{r.status}</td>
                    <td>
                      {total} {r.currency || "GBP"}
                    </td>
                    <td>
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                    <td className="text-right">
                      {pdf ? (
                        <a
                          href={pdf}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-sm"
                        >
                          View
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
