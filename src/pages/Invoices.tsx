// src/pages/Invoices.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

type CategoryRow = {
  id: string;
  name: string;
  slug?: string | null;
};

type JoinedAreaRow = {
  id: string;
  name: string;
  category_id?: string | null;
};

type SubscriptionJoin = {
  id: string;
  business_id: string | null;
  area_id: string | null;
};

type InvoiceRow = {
  id: string;

  sponsored_subscription_id: string | null;
  stripe_invoice_id: string | null;

  status: string | null;
  amount_due_pennies: number | null;
  currency: string | null;

  period_start: string | null;
  period_end: string | null;
  created_at: string;

  hosted_invoice_url: string | null;
  invoice_pdf: string | null;

  // joins
  sponsored_subscription?: SubscriptionJoin | null;
  service_area?: JoinedAreaRow | null;
};

function moneyFromPennies(
  pennies: number | null | undefined,
  currency: string | null | undefined
) {
  const p = Number.isFinite(Number(pennies)) ? Number(pennies) : 0;
  const cur = (currency || "GBP").toUpperCase();
  const amount = p / 100;

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: cur,
    }).format(amount);
  } catch {
    const sym = cur === "GBP" ? "£" : "";
    return `${sym}${amount.toFixed(2)}`;
  }
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
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
  const [yStr, mStr] = key.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
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

        // Get cleaner/business id for this user
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

        // Load industries (categories) the business is in
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

        /**
         * ✅ Correct invoice query:
         * - sponsored_invoices has NO cleaner_id
         * - filter via sponsored_subscriptions.business_id
         * - join service_areas via service_area_id (FK)
         */
        const { data: invData, error: invErr } = await supabase
          .from("sponsored_invoices")
          .select(
            `
            id,
            sponsored_subscription_id,
            stripe_invoice_id,
            status,
            amount_due_pennies,
            currency,
            period_start,
            period_end,
            created_at,
            hosted_invoice_url,
            invoice_pdf,

            sponsored_subscription:sponsored_subscriptions (
              id,
              business_id,
              area_id
            ),

            service_area:service_areas (
              id,
              name,
              category_id
            )
          `
          )
          .eq("sponsored_subscription.business_id", cid)
          .order("created_at", { ascending: false });

        if (invErr) throw invErr;

        const normalized: InvoiceRow[] = ((invData || []) as unknown as any[]).map(
          (row) => {
            const sa = row.service_area;
            const ss = row.sponsored_subscription;

            return {
              ...row,
              // normalize any weird array returns (defensive)
              service_area: Array.isArray(sa) ? sa[0] || null : sa || null,
              sponsored_subscription: Array.isArray(ss) ? ss[0] || null : ss || null,
            };
          }
        );

        if (alive) {
          setInvoices(normalized);
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
        const catId = inv.service_area?.category_id || null;
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
          <p className="muted">Your invoice history ({filtered.length})</p>
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

            <button
              className="btn md:justify-self-end"
              onClick={clearFilters}
              disabled={loading}
            >
              Clear
            </button>
          </div>

          {errorMsg ? <div className="alert alert-error mt-4">{errorMsg}</div> : null}
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
                    <th className="text-left py-3 pr-3">Stripe invoice</th>
                    <th className="text-left py-3 pr-3">Industry</th>
                    <th className="text-left py-3 pr-3">Area</th>
                    <th className="text-left py-3 pr-3">Period start</th>
                    <th className="text-left py-3 pr-3">Status</th>
                    <th className="text-left py-3 pr-3">Amount due</th>
                    <th className="text-left py-3 pr-3">Created</th>
                    <th className="text-left py-3">Download</th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((inv) => {
                    const area = inv.service_area || null;
                    const catId = area?.category_id || null;
                    const industry = catId ? categoryNameById.get(catId) : null;

                    const periodStart = inv.period_start
                      ? fmtDateOnly(inv.period_start)
                      : inv.created_at
                      ? fmtDateOnly(inv.created_at)
                      : "—";

                    const pdfLink = inv.invoice_pdf || inv.hosted_invoice_url || null;
                    const statusLabel = (inv.status || "—").toString().split("_").join(" ");

                    return (
                      <tr key={inv.id} className="border-b border-ink-50">
                        <td className="py-3 pr-3 font-medium">
                          {inv.stripe_invoice_id || "—"}
                        </td>

                        <td className="py-3 pr-3">{industry || "—"}</td>

                        <td className="py-3 pr-3">{area?.name || "—"}</td>

                        <td className="py-3 pr-3">{periodStart}</td>

                        <td className="py-3 pr-3">{statusLabel}</td>

                        <td className="py-3 pr-3">
                          {moneyFromPennies(inv.amount_due_pennies, inv.currency)}
                        </td>

                        <td className="py-3 pr-3">
                          {inv.created_at ? fmtDateTime(inv.created_at) : "—"}
                        </td>

                        <td className="py-3">
                          {pdfLink ? (
                            <a className="link" href={pdfLink} target="_blank" rel="noreferrer">
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
                If “PDF” is blank, it means Stripe hasn’t provided an invoice PDF yet for that
                invoice.
              </p>
            </div>
          )}
        </div>
      </section>

      {cleanerId ? <div className="mt-6 text-xs muted">Cleaner: {cleanerId}</div> : null}
    </div>
  );
}
