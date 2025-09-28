// src/components/icons/services.tsx
export const SERVICE_LABELS: Record<string, string> = {
  domestic: "Domestic",
  commercial: "Commercial",
};

const FILES: Record<string, string> = {
  domestic: "/service-icons/house.svg",       // change if different
  commercial: "/service-icons/briefcase.svg", // change if different
};

export function ServicePill({ kind }: { kind: string }) {
  const label = SERVICE_LABELS[kind] ?? kind;
  const src = FILES[kind] ?? "/service-icons/house.svg";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-black/10 bg-white">
      <img src={src} alt="" className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
