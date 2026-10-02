import { memo } from "react";
import type { CoverSpec } from "@/contracts/models";
import { cn } from "@/lib/cn";

/**
 * Couverture originale générée en SVG (aucune image externe). Ratio 3:4 réservé pour éviter
 * les décalages de mise en page. Décorative : le titre est déjà présent en texte à côté.
 */
function Motif({ motif, accent, ink }: { motif: CoverSpec["motif"]; accent: string; ink: string }) {
  switch (motif) {
    case "columns":
      return (
        <g opacity="0.9">
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={14 + i * 32} y={132} width={26} height={3} fill={ink} opacity={0.75} />
              {[0, 1, 2, 3, 4, 5].map((j) => (
                <rect key={j} x={14 + i * 32} y={140 + j * 7} width={j === 5 ? 16 : 26} height={2} fill={ink} opacity={0.35} />
              ))}
            </g>
          ))}
          <rect x={14} y={96} width={92} height={28} fill={accent} />
        </g>
      );
    case "bars":
      return (
        <g>
          {[46, 70, 58, 92, 80].map((h, i) => (
            <rect key={i} x={16 + i * 18} y={186 - h} width={12} height={h} fill={i === 3 ? accent : ink} opacity={i === 3 ? 1 : 0.28} />
          ))}
        </g>
      );
    case "arcs":
      return (
        <g fill="none" strokeWidth={6}>
          <path d="M-10 190 A 70 70 0 0 1 130 190" stroke={accent} />
          <path d="M10 190 A 50 50 0 0 1 110 190" stroke={ink} opacity={0.4} />
          <path d="M30 190 A 30 30 0 0 1 90 190" stroke={accent} opacity={0.7} />
        </g>
      );
    case "grid":
      return (
        <g>
          {Array.from({ length: 16 }, (_, i) => (
            <rect key={i} x={18 + (i % 4) * 22} y={104 + Math.floor(i / 4) * 22} width={16} height={16} fill={i % 5 === 0 ? accent : ink} opacity={i % 5 === 0 ? 1 : 0.18} />
          ))}
        </g>
      );
    case "waves":
      return (
        <g fill="none" strokeWidth={4}>
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M0 ${120 + i * 18} q 15 -10 30 0 t 30 0 t 30 0 t 30 0`} stroke={i === 1 ? accent : ink} opacity={i === 1 ? 1 : 0.3} />
          ))}
        </g>
      );
    case "rings":
      return (
        <g fill="none">
          <circle cx={60} cy={150} r={38} stroke={ink} strokeWidth={3} opacity={0.3} />
          <circle cx={60} cy={150} r={24} stroke={accent} strokeWidth={6} />
          <circle cx={60} cy={150} r={8} fill={ink} opacity={0.6} />
        </g>
      );
  }
}

export const Cover = memo(function Cover({ spec, title, className, size = "md" }: { spec: CoverSpec; title: string; className?: string; size?: "sm" | "md" | "lg" }) {
  const [bg, ink, accent] = spec.palette;
  const shortTitle = title.length > 26 ? `${title.slice(0, 24)}…` : title;
  const words = shortTitle.split(" ");
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + word).length <= 13) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return (
    <div className={cn("relative aspect-[3/4] overflow-hidden rounded-md shadow-card ring-1 ring-ink/10", size === "sm" && "w-16", className)} aria-hidden>
      <svg viewBox="0 0 120 160" preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="presentation">
        <rect width="120" height="160" fill={bg} />
        <text x="12" y="20" fill={accent} fontSize="7" fontFamily="Inter Variable, sans-serif" fontWeight="700" letterSpacing="1.2">
          {spec.kicker.toUpperCase()}
        </text>
        <rect x="12" y="25" width="96" height="0.8" fill={ink} opacity="0.5" />
        {lines.slice(0, 3).map((line, i) => (
          <text key={i} x="12" y={44 + i * 15} fill={ink} fontSize="13" fontFamily="Fraunces Variable, Georgia, serif" fontWeight="650">
            {line}
          </text>
        ))}
        <g transform="translate(0 -30)">
          <Motif motif={spec.motif} accent={accent} ink={ink} />
        </g>
      </svg>
    </div>
  );
});
