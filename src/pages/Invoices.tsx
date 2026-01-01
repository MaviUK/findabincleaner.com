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
          .in("sponsored_subscripti_
