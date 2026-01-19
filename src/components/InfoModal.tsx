import React from "react";

type Props = {
  open: boolean;
  title?: string;
  message: string;
  onClose: () => void;
  busy?: boolean;
};

export default function InfoModal({
  open,
  title = "Notice",
  message,
  onClose,
  busy,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-amber-200">
        <div className="px-4 py-3 border-b border-amber-200 flex items-center justify-between bg-amber-50 rounded-t-xl">
          <div className="font-semibold text-amber-900">{title}</div>
          <button
            className="text-sm opacity-70 hover:opacity-100"
            onClick={() => {
              if (busy) return;
              onClose();
            }}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <div className="px-4 py-4">
          <div className="text-sm text-gray-800">{message}</div>
        </div>

        <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={busy}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
