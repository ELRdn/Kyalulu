import "./ui.css";

const GRADIENTS = [
  "var(--gradient-mystic-dream)",
  "var(--gradient-parallel-world)",
  "var(--gradient-mint-breeze)",
];
function gradientFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

export default function WorldCard({
  id,
  displayName,
  description,
  onClick,
}: {
  id: string;
  displayName: string;
  description: string;
  onClick?: () => void;
}) {
  return (
    <div className="k-media-card k-media-card--world" onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}>
      <div className="k-media-card__art" style={{ background: gradientFor(id) }}>
        ✦
      </div>
      <div className="k-media-card__body">
        <div className="k-media-card__title">{displayName}</div>
        <div className="k-media-card__hook">{description}</div>
      </div>
    </div>
  );
}
