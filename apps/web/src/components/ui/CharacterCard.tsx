import { Link } from "react-router-dom";
import Badge from "./Badge";
import { moodLabelFor } from "../../lib/moodTaxonomy";
import "./ui.css";

const GRADIENTS = [
  "var(--gradient-kyalulu-glow)",
  "var(--gradient-mystic-dream)",
  "var(--gradient-parallel-world)",
  "var(--gradient-tyarai-mode)",
  "var(--gradient-mint-breeze)",
];
function gradientFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

export default function CharacterCard({
  id,
  displayName,
  hook,
  creator = "Local",
  tags = [],
  portraitUrl,
}: {
  id: string;
  displayName: string;
  hook: string;
  creator?: string;
  tags?: string[];
  portraitUrl?: string | null;
}) {
  return (
    <Link to={`/characters/${encodeURIComponent(id)}`} className="k-media-card">
      <div className="k-media-card__art" style={{ background: gradientFor(id) }}>
        {portraitUrl ? <img src={portraitUrl} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : displayName.trim().charAt(0)}
      </div>
      <div className="k-media-card__body">
        <div className="k-media-card__title">{displayName}</div>
        <div className="k-media-card__hook">{hook}</div>
        <div className="k-media-card__meta">by {creator}</div>
        {tags.length > 0 && (
          <div className="k-media-card__tags">
            {tags.slice(0, 3).map((t) => {
              const m = moodLabelFor(t);
              return (
                <Badge key={t} tone="accent">
                  {m.label}
                </Badge>
              );
            })}
          </div>
        )}
      </div>
    </Link>
  );
}
