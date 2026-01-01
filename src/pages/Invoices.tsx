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
  category?: CategoryRow | null; // joined categories row
};

type SubscriptionJoin = {
  id: string;
  business_id: string | null;
  area_id: string | null;
  service_area?: JoinedAreaRow | null; // deep-join area via subscription
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

        /**
         * ✅ IMPORTANT FIX:
         * We cannot join sponsored_invoices -> service_areas directly.
         * We must go: sponsored_invoices -> sponsored_subscriptions -> service_areas -> categories
         *
         * Step 1: get this business's subscriptions (ids)
         */
        const { data: subs, error: subsErr } = await supabase
          .from("sponsored_subscriptions")
          .select("id")
          .eq("business_id", cid);

        if (subsErr) throw subsErr;

        const subIds = (subs || [])
          .map((s: any) => String(s.id))
          .filter(Boolean);

        if (subIds.length === 0) {
          if (alive) {
            setInvoices([]);
            setCategories([]);
            setLoading(false);
          }
          return;
        }

        /**
         * Step 2: fetch invoices for those subscription ids with deep joins
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
              area_id,
              service_area:service_areas (
                id,
                name,
                category_id,
                category:categories (
                  id,
                  name,
                  slug
                )
              )
            )
          `
          )
          .in("sponsored_subscription_id", subIds)
          .order("created_at", { ascending: false });

        if (invErr) throw invErr;

        const normalized: InvoiceRow[] = ((invData || []) as any[]).map((row) => {
          const ss = row.sponsored_subscription;

          // defensive: sometimes embedded relations come back as arrays
          const ssObj = Array.isArray(ss) ? ss[0] || null : ss || null;

          if (ssObj?.service_area && Array.isArray(ssObj.service_area)) {
            ssObj.service_area = ssObj.service_area[0] || null;
          }
          if (ssObj?.service_area?.category && Array.isArray(ssObj.service_area.category)) {
            ssObj.service_area.category = ssObj.service_area.category[0] || null;
          }

          return {
            ...row,
            sponsored_subscription: ssObj,
          };
        });

        // Build categories list directly from the invoice joins
        const catMap = new Map<string, CategoryRow>();
        for (const inv of normalized) {
          const cat = inv.sponsored_subscription?.service_area?.category || null;
          if (cat?.id && cat?.name) catMap.set(String(cat.id), { id: String(cat.id), name: String(cat.name), slug: cat.slug ?? null });
        }
        const catRows = Array.from(catMap.values()).sort((a, b) =>
          a.name.localeCompare(b.name)
        );

        if (alive) {
          setInvoices(normalized);
          setCategories(catRows);
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
        const catId = inv.sponsored_subscription?.service_area?.category_id || null;
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

            <button className="btn md:justify-self-end" onClick={clearFilters} disabled={loading}>
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
                    const area = inv.sponsored_subscription?.service_area || null;
                    const catId = area?.category_id || null;

                    // prefer joined category name; fallback to map
                    const industry =
                      area?.category?.name ||
                      (catId ? categoryNameById.get(catId) : null) ||
                      null;

                    const periodStart = inv.period_start
                      ? fmtDateOnly(inv.period_start)
                      : inv.created_at
                      ? fmtDateOnly(inv.created_at)
                      : "—";

                    const pdfLink = inv.invoice_pdf || inv.hosted_invoice_url || null;
                    const statusLabel = (inv.status || "—").toString().split("_").join(" ");

                    return (
                      <tr key={inv.id} className="border-b border-ink-50">
                        <td className="py-3 pr-3 font-medium">{inv.stripe_invoice_id || "—"}</td>

                        <td className="py-3 pr-3">{industry || "—"}</td>

                        <td className="py-3 pr-3">{area?.name || "—"}</td>

                        <td className="py-3 pr-3">{periodStart}</td>

                        <td className="py-3 pr-3">{statusLabel}</td>

                        <td className="py-3 pr-3">
                          {moneyFromPennies(inv.amount_due_pennies, inv.currency)}
                        </td>

                        <td className="py-3 pr-3">{inv.created_at ? fmtDateTime(inv.created_at) : "—"}</td>

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
                If “PDF” is blank, it means Stripe hasn’t provided an invoice PDF yet for that invoice.
              </p>
            </div>
          )}
        </div>
      </section>

      {cleanerId ? <div className="mt-6 text-xs muted">Cleaner: {cleanerId}</div> : null}
    </div>
  );
}
