import { RuntimeImage } from '../RuntimeMedia';
import { Link } from "react-router-dom";
import "./ui.css";

/** Image first, then the name and the author's one-line scene (docs/MOBILE_UX_SPEC.md §5.1). */
export default function CharacterCard({
  id,
  displayName,
  hook,
  portraitUrl,
}: {
  id: string;
  displayName: string;
  hook: string;
  creator?: string;
  tags?: string[];
  portraitUrl?: string | null;
  talks?: number;
}) {
  return (
    <Link to={`/characters/${encodeURIComponent(id)}`} className="k-media-card k-char-card">
      <div className="k-media-card__art">
        {portraitUrl ? <RuntimeImage src={portraitUrl} alt="" loading="lazy" className="k-media-card__img" />
          : <span className="k-char-card__initial" aria-hidden="true">{displayName.trim().charAt(0)}</span>}
      </div>
      <div className="k-media-card__body">
        <div className="k-media-card__title">{displayName}</div>
        <div className="k-media-card__hook">{hook}</div>
      </div>
    </Link>
  );
}
