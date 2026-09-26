import { Link } from "react-router-dom";
import { moodsOf } from "../../lib/moodTaxonomy";
import { gradientFor } from "./Avatar";
import Icon from "./Icon";
import { formatCount } from "../../lib/text";
import "./ui.css";

export default function CharacterCard({
  id,
  displayName,
  hook,
  creator = "Local",
  tags = [],
  portraitUrl,
  talks = 0,
}: {
  id: string;
  displayName: string;
  hook: string;
  creator?: string;
  tags?: string[];
  portraitUrl?: string | null;
  /** このキャラとの累計メッセージ数（0なら表示しない） */
  talks?: number;
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
        {talks > 0 && (
          <span className="k-char-card__count" aria-label={`${talks}メッセージ`}>
            <Icon name="chat" size={11} /> {formatCount(talks)}
          </span>
        )}
        <span className="k-char-card__cta" aria-hidden="true">話してみる ✦</span>
      </div>
      <div className="k-media-card__body">
        <div className="k-media-card__title">{displayName}</div>
        <div className="k-media-card__hook">{hook}</div>
        {moods.length > 1 && <div className="k-media-card__hashtags">{moods.slice(1, 4).map((m) => `#${m.label}`).join(" ")}</div>}
        <div className="k-media-card__meta">by {creator}</div>
      </div>
    </Link>
  );
}
