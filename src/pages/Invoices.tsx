// src/pages/Invoices.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

type CategoryRow = {
  id: string;
  name: string;
  slug?: string | null;
};

type InvoiceRow = {
  id: string;
  cleaner_id: string;
  area_id: string | null;

  invoice_number: string | null;
  status: string | null;

  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  currency: string | null;

  billing_period_start: string | null;
  billing_period_end: string | null;
  created_at: string;

  pdf_url: string | null;
  pdf_signed_url: string | null;
  pdf_storage_path: string | null;

  // joined
  service_areas?: {
    id: string;
    name: string;
    category_id?: string | null;
  } | null;
};

function moneyFromCents(
  cents: number | null | undefined,
  currency: string | null | undefined
) {
  const c = Number.isFinite(Number(cents)) ? Number(cents) : 0;
  const cur = (currency || "GBP").toUpperCase();
  // stored as cents, so 317 => 3.17
  const amount = c / 100;

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: cur,
    }).format(amount);
  } catch {
    // fallback
    const sym = cur === "GBP" ? "£" : "";
    return `${sym}${amount.toFixed(2)}`;
  }
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  // "30 Dec 2025, 00:42"
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDateOnly(iso: string) {
  const d = new Date(iso);
  // "2025-12-30" style
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthKeyFromISO(iso: string) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // YYYY-MM
}

function monthLabelFromKey(key: string) {
  // key: YYYY-MM
  const [y, m] = key.split("-").map((x) => Number(x));
  const d = new Date(y, (m || 1) - 1, 1);
  return d.toLocaleString("en-GB", { month: "long", year: "numeric" });
}

export default function Invoices() {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [cleanerId, setCleanerId] = useState<string | null>(null);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);

  // Filters
  const [industryFilter, setIndustryFilter] = useState<string>("all"); // category_id OR "all"
  const [monthFilter, setMonthFilter] = useState<string>("all"); // YYYY-MM OR "all"

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErrorMsg(null);

      try {
        const {
          data: { session },
          error: sessErr,
        } = await supabase.auth.getSession();

        if (sessErr) throw sessErr;
        if (!session?.user) {
          if (alive) {
            setErrorMsg("You must be logged in to view invoices.");
            setLoading(false);
          }
          return;
        }

        // Get cleaner id for this user
        const { data: cleaner, error: cleanerErr } = await supabase
          .from("cleaners")
          .select("id")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (cleanerErr) throw cleanerErr;
        if (!cleaner?.id) {
          if (alive) {
            setErrorMsg("Could not find your business profile.");
            setLoading(false);
          }
          return;
        }

        const cid = String(cleaner.id);
        if (!alive) return;
        setCleanerId(cid);

        // 1) Load industries (categories) the business is in
        // Prefer RPC if you already have it (your Network shows list_active_categories_for_cleaner).
        let catRows: CategoryRow[] = [];
        const { data: rpcCats, error: rpcErr } = await supabase.rpc(
          "list_active_categories_for_cleaner",
          { _cleaner_id: cid }
        );

        if (!rpcErr && Array.isArray(rpcCats)) {
          catRows = rpcCats
            .map((r: any) => ({
              id: String(r.id),
              name: String(r.name),
              slug: r.slug ? String(r.slug) : null,
            }))
            .filter((r) => r.id && r.name);
        }

        if (alive) setCategories(catRows);

        // 2) Load invoices (ALL initially)
        // Join service_areas for area name + category_id (to map to industry)
        const { data: invData, error: invErr } = await supabase
          .from("sponsored_invoices")
          .select(
            `
            id,
            cleaner_id,
            area_id,
            stripe_invoice_id,
            stripe_payment_intent_id,
            invoice_number,
            status,
            subtotal_cents,
            tax_cents,
            total_cents,
            currency,
            billing_period_start,
            billing_period_end,
            pdf_url,
            emailed_at,
            created_at,
            supplier_name,
            supplier_address,
            supplier_email,
            supplier_vat,
            customer_name,
            customer_email,
            customer_address,
            area_km2,
            rate_per_km2_cents,
            pdf_storage_path,
            pdf_signed_url,
            service_areas (
              id,
              name,
              category_id
            )
          `
          )
          .eq("cleaner_id", cid)
          .order("created_at", { ascending: false });

        if (invErr) throw invErr;

        if (alive) {
          setInvoices((invData as InvoiceRow[]) || []);
          setLoading(false);
        }
      } catch (e: any) {
        console.error(e);
        if (alive) {
          setErrorMsg(e?.message || "Failed to load invoices.");
          setLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);

  const allMonths = useMemo(() => {
    const keys = new Set<string>();
    for (const inv of invoices) {
      if (inv?.created_at) keys.add(monthKeyFromISO(inv.created_at));
    }
    return Array.from(keys).sort((a, b) => (a < b ? 1 : -1)); // newest first
  }, [invoices]);

  const filtered = useMemo(() => {
    let list = invoices.slice();

    if (industryFilter !== "all") {
      list = list.filter((inv) => {
        const catId = inv.service_areas?.category_id || null;
        return catId === industryFilter;
      });
    }

    if (monthFilter !== "all") {
      list = list.filter((inv) => monthKeyFromISO(inv.created_at) === monthFilter);
    }

    return list;
  }, [invoices, industryFilter, monthFilter]);

  const clearFilters = () => {
    setIndustryFilter("all");
    setMonthFilter("all");
  };

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="section-title text-2xl mb-1">Invoices</h1>
          <p className="muted">
            Your invoice history ({filtered.length})
          </p>
        </div>

        <Link to="/dashboard" className="btn">
          Back to dashboard
        </Link>
      </div>

      <section className="card mt-6">
        <div className="card-pad">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
            <div>
              <label className="block text-sm font-medium mb-1">Sort by industry</label>
              <select
                className="input w-full"
                value={industryFilter}
                onChange={(e) => setIndustryFilter(e.target.value)}
                disabled={loading}
              >
                <option value="all">All industries</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Month issued</label>
              <select
                className="input w-full"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                disabled={loading}
              >
                <option value="all">All months</option>
                {allMonths.map((k) => (
                  <option key={k} value={k}>
                    {monthLabelFromKey(k)}
                  </option>
                ))}
              </select>
            </div>

            <button className="btn md:justify-self-end" onClick={clearFilters} disabled={loading}>
              Clear
            </button>
          </div>

          {errorMsg ? (
            <div className="alert alert-error mt-4">{errorMsg}</div>
          ) : null}
        </div>
      </section>

      <section className="card mt-6">
        <div className="card-pad">
          {loading ? (
            <div className="muted">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="muted">No invoices found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-100">
                    <th className="text-left py-3 pr-3">Invoice</th>
                    <th className="text-left py-3 pr-3">Industry</th>
                    <th className="text-left py-3 pr-3">Area</th>
                    <th className="text-left py-3 pr-3">Period</th>
                    <th className="text-left py-3 pr-3">Status</th>
                    <th className="text-left py-3 pr-3">Total</th>
                    <th className="text-left py-3 pr-3">Created</th>
                    <th className="text-left py-3">Download</th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((inv) => {
                    const catId = inv.service_areas?.category_id || null;
                    const industry = catId ? categoryNameById.get(catId) : null;

                    // ✅ You asked: billing period only needs start date
                    const periodStart = inv.billing_period_start
                      ? fmtDateOnly(inv.billing_period_start)
                      : inv.created_at
                        ? fmtDateOnly(inv.created_at)
                        : "—";

                    const pdfLink = inv.pdf_signed_url || inv.pdf_url || null;

                    return (
                      <tr key={inv.id} className="border-b border-ink-50">
                        <td className="py-3 pr-3 font-medium">
                          {inv.invoice_number || "—"}
                        </td>

                        <td className="py-3 pr-3">
                          {industry || "—"}
                        </td>

                        <td className="py-3 pr-3">
                          {inv.service_areas?.name || "—"}
                        </td>

                        <td className="py-3 pr-3">
                          {periodStart}
                        </td>

                        <td className="py-3 pr-3">
                          {(inv.status || "—").toString().replaceAll("_", " ")}
                        </td>

                        <td className="py-3 pr-3">
                          {moneyFromCents(inv.total_cents, inv.currency)}
                        </td>

                        <td className="py-3 pr-3">
                          {inv.created_at ? fmtDateTime(inv.created_at) : "—"}
                        </td>

                        <td className="py-3">
                          {pdfLink ? (
                            <a
                              className="link"
                              href={pdfLink}
                              target="_blank"
                              rel="noreferrer"
                            >
                              PDF
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

              <p className="muted mt-3 text-xs">
                If “PDF” is blank, it means this invoice row doesn’t have a stored PDF URL yet.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
