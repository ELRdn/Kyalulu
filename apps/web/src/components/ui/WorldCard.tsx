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
      <span className={`k-world-row__thumb k-world-scene ${sceneFor(id)}`} aria-hidden="true">
        <span className="k-world-scene__moon" />
        <span className="k-world-scene__stars" />
      </span>
      <span className="k-world-row__text">
        <span className="k-world-row__name">{displayName}</span>
        <span className="k-world-row__desc">{description}</span>
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className="k-world-row" onClick={onClick} aria-pressed={active}>
      {body}
    </button>
  ) : (
    <div className="k-world-row">{body}</div>
  );
}
