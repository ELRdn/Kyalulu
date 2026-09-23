import "./ui.css";

const SCENES = ["k-world-scene--dusk", "k-world-scene--night", "k-world-scene--mint"];
function sceneFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return SCENES[h % SCENES.length];
}

export default function WorldCard({
  id,
  displayName,
  description,
  onClick,
  active = false,
}: {
  id: string;
  displayName: string;
  description: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <div className={`k-media-card__art k-world-scene ${sceneFor(id)}`} aria-hidden="true">
        <span className="k-world-scene__moon" />
        <span className="k-world-scene__stars" />
        <span className="k-world-scene__horizon" />
      </div>
      <div className="k-media-card__body">
        <div className="k-media-card__title">{displayName}</div>
        <div className="k-media-card__hook">{description}</div>
      </div>
    </>
  );
  return onClick ? (
    <button type="button" className={`k-media-card k-media-card--world ${active ? "k-media-card--selected" : ""}`} onClick={onClick} aria-pressed={active}>
      {body}
    </button>
  ) : (
    <div className="k-media-card k-media-card--world">{body}</div>
  );
}
