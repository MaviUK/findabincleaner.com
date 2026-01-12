import React, { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Props = {
  open: boolean;
  onClose: () => void;
  areaId: string;
  areaName: string;
  cleanerId: string;
  isSponsoredByMe: boolean;
  onDeleted: () => Promise<void> | void;
};

export default function DeleteAreaModal({
  open,
  onClose,
  areaId,
  areaName,
  cleanerId,
  isSponsoredByMe,
  onDeleted,
}: Props) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mustType = useMemo(() => (areaName || "").trim(), [areaName]);
  const matches = typed.trim().toLowerCase() === mustType.toLowerCase();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-amber-200">
        <div className="px-4 py-3 border-b border-amber-200 flex items-center justify-between bg-amber-50 rounded-t-xl">
          <div className="font-semibold text-amber-900">Delete Area</div>
          <button
            className="text-sm opacity-70 hover:opacity-100"
            onClick={() => {
              if (busy) return;
              setTyped("");
              setErr(null);
              onClose();
            }}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <div className="px-4 py-4 space-y-3">
          <div className="text-sm">
            You are about to delete: <span className="font-semibold">{areaName}</span>
          </div>

          {isSponsoredByMe ? (
            <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded p-3">
              <div className="font-semibold mb-1">This area is sponsored.</div>
              <div>
                Deleting it will also{" "}
                <span className="font-semibold">cancel your subscription at the period end</span>,
                so it <span className="font-semibold">will not renew</span> on the next renewal date.
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded p-3">
              This will permanently delete the polygon.
            </div>
          )}

          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {err}
            </div>
          )}

          <div className="space-y-1">
            <div className="text-sm font-medium">
              Type <span className="font-mono">{mustType}</span> to confirm
            </div>
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type the area name exactly…"
              disabled={busy}
            />
          </div>
        </div>

        <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
          <button
            className="btn"
            onClick={() => {
              if (busy) return;
              setTyped("");
              setErr(null);
              onClose();
            }}
            disabled={busy}
          >
            Cancel
          </button>

          <button
            className={`btn ${!matches ? "opacity-50 cursor-not-allowed" : ""}`}
            disabled={!matches || busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);

              try {
                if (isSponsoredByMe) {
                  const session = (await supabase.auth.getSession())?.data?.session;
                  const token = session?.access_token;
                  if (!token) throw new Error("You must be logged in.");

                  const res = await fetch("/.netlify/functions/cancel-sponsored-area", {
                    method: "POST",
                    headers: {
                      "content-type": "application/json",
                      Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                      areaId,
                      cleanerId,
                      slot: 1,
                      mode: "cancel_at_period_end", // remove this if your function doesn't support it
                    }),
                  });

                  const j = await res.json().catch(() => ({}));
                  if (!res.ok || !j?.ok) throw new Error(j?.error || `Failed (${res.status})`);

                  // ✅ ensure polygon is deleted (even if the function only cancels)
                  const del = await supabase.rpc("delete_service_area", { p_area_id: areaId });
                  if (del.error) {
                    // ignore "already deleted" / "not found" style errors
                    const msg = String(del.error.message || "");
                    if (!msg.toLowerCase().includes("not") && !msg.toLowerCase().includes("found")) {
                      throw del.error;
                    }
                  }
                } else {
                  const { error } = await supabase.rpc("delete_service_area", { p_area_id: areaId });
                  if (error) throw error;
                }

                await onDeleted();
                setTyped("");
                onClose();
              } catch (e: any) {
                setErr(e?.message || "Delete failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Deleting…" : "Delete Area"}
          </button>
        </div>
      </div>
    </div>
  );
}
