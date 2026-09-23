import { Link } from "react-router-dom";
import { moodsOf } from "../../lib/moodTaxonomy";
import { gradientFor } from "./Avatar";
import "./ui.css";

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
  const moods = moodsOf(tags);
  return (
    <Link to={`/characters/${encodeURIComponent(id)}`} className="k-media-card k-char-card">
      <div className="k-media-card__art" style={portraitUrl ? undefined : { background: gradientFor(id) }}>
        {portraitUrl ? (
          <img src={portraitUrl} alt="" loading="lazy" className="k-media-card__img" />
        ) : (
          <span className="k-char-card__sigil" aria-hidden="true">
            <span>{displayName.trim().charAt(0)}</span>
          </span>
        )}
        <span className="k-char-card__sparkles" aria-hidden="true" />
        {moods[0] && <span className="k-char-card__badge">{moods[0].label}</span>}
        <span className="k-char-card__cta" aria-hidden="true">話してみる ✦</span>
      </div>
      <div className="k-media-card__body">
        <div className="k-media-card__title">{displayName}</div>
        <div className="k-media-card__hook">{hook}</div>
        <div className="k-media-card__meta">by {creator}</div>
        {moods.length > 1 && (
          <div className="k-media-card__tags">
            {moods.slice(1, 3).map((m) => (
              <span key={m.tag} className="k-mini-tag">
                {m.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
