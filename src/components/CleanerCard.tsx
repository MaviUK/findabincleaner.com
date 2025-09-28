// src/components/CleanerCard.tsx
import { useState } from "react";

type Props = {
  name: string;
  logoUrl?: string;
  area?: string;
  contactUrl?: string; // e.g., WhatsApp link or mailto
  phone?: string;      // plain digits preferred
  websiteUrl?: string;
};

export default function CleanerCard({
  name,
  logoUrl,
  area,
  contactUrl,
  phone,
  websiteUrl,
}: Props) {
  const [showPhone, setShowPhone] = useState(false);

  return (
    <div className="card card-pad flex flex-col gap-4">
      <div className="flex items-center gap-4">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={`${name} logo`}
            className="h-12 w-12 rounded-lg object-contain bg-white/5 p-1"
          />
        ) : (
          <div className="h-12 w-12 rounded-lg bg-white/10 grid place-items-center text-white/70">
            {name.charAt(0)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold text-cream-100 truncate">{name}</div>
          {area && <div className="text-sm text-white/70 truncate">{area}</div>}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 pt-2">
        {contactUrl && (
          <a
            href={contactUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary rounded-xl2"
          >
            Contact
          </a>
        )}

        {phone && (
          <button
            type="button"
            className="btn btn-ghost border border-white/10 hover:border-white/20"
            onClick={() => setShowPhone(s => !s)}
            aria-expanded={showPhone}
            aria-controls={`phone_${slugify(name)}`}
            title={showPhone ? "Hide number" : "Show phone number"}
          >
            {showPhone ? "Hide number" : "Phone"}
          </button>
        )}

        {websiteUrl && (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost border border-white/10 hover:border-white/20"
          >
            Website
          </a>
        )}
      </div>

      {showPhone && phone && (
        <div
          id={`phone_${slugify(name)}`}
          className="rounded-lg bg-night-800/70 border border-white/10 p-3 text-white/90 flex items-center justify-between"
        >
          <span className="font-medium tracking-wide">{prettyPhone(phone)}</span>
          <a className="btn btn-primary" href={`tel:${phone}`}>Call</a>
        </div>
      )}
    </div>
  );
}

function slugify(s: string) {
  return s.toLowerCase().replace(/\s+/g, "_");
}

function prettyPhone(p?: string) {
  if (!p) return "";
  const digits = p.replace(/[^\d+]/g, "");
  if (digits.startsWith("+44")) return "+44 " + digits.slice(3);
  return digits || p;
}
