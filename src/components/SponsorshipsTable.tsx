import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Row = {
  id: string;
  area_name: string | null;
  slot: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  area_km2: number | null;
};

export default function SponsorshipsTable({ cleanerId }: { cleanerId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("v_my_sponsorships")
        .select("id,slot,starts_at,ends_at,is_active,area_name,area_km2")
        .eq("cleaner_id", cleanerId)
        .order("starts_at", { ascending: false });
      if (error) throw error;
      setRows((data || []) as Row[]);
    } catch (e: any) {
      setErr(e.message || "Failed to load sponsorships");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // live updates (optional)
    const ch = supabase
      .channel("sponsorships-watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sponsorships", filter: `cleaner_id=eq.${cleanerId}` },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [cleanerId]);

  async function cancel(id: string) {
    if (!confirm("Cancel this sponsored area? It will stop being #1 immediately.")) return;
    const { error } = await supabase
      .from("sponsorships")
      .update({ is_active: false, ends_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      alert(error.message || "Failed to cancel");
    } else {
      await load();
    }
  }

  if (loading) return <div className="muted">Loading…</div>;
  if (err) return <div className="text-red-600">{err}</div>;
  if (rows.length === 0) return <div className="muted">No sponsored areas yet.</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-gray-500">
          <tr>
            <th className="py-2 pr-3">Area</th>
            <th className="py-2 pr-3">Slot</th>
            <th className="py-2 pr-3">Size (km²)</th>
            <th className="py-2 pr-3">Starts</th>
            <th className="py-2 pr-3">Ends</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="py-2 pr-3">{r.area_name || "Sponsored area"}</td>
              <td className="py-2 pr-3">#{r.slot}</td>
              <td className="py-2 pr-3">{r.area_km2?.toFixed(4)}</td>
              <td className="py-2 pr-3">{r.starts_at ? new Date(r.starts_at).toLocaleDateString() : "—"}</td>
              <td className="py-2 pr-3">
                {r.is_active ? "—" : r.ends_at ? new Date(r.ends_at).toLocaleDateString() : "—"}
              </td>
              <td className="py-2 pr-3">
                {r.is_active ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-green-100 text-green-800">
                    Active
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                    Ended
                  </span>
                )}
              </td>
              <td className="py-2">
                {r.is_active && (
                  <button className="text-red-600 underline" onClick={() => cancel(r.id)}>
                    Cancel
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
