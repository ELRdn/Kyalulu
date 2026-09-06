import "./ui.css";

const GRADIENTS = [
  "var(--gradient-kyalulu-glow)",
  "var(--gradient-mystic-dream)",
  "var(--gradient-parallel-world)",
  "var(--gradient-tyarai-mode)",
  "var(--gradient-mint-breeze)",
];

/** id文字列から安定的にグラデーションを選ぶ（キャラクター画像バックエンド未対応のためのプレースホルダー） */
function gradientFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

export default function Avatar({
  name,
  seed,
  size = "md",
  src,
}: {
  name: string;
  seed?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  src?: string | null;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const bg = gradientFor(seed ?? name);
  return (
    <span className={`k-avatar k-avatar--${size}`} style={src ? undefined : { background: bg }} aria-hidden={!!name}>
      {src ? <img src={src} alt="" /> : initial}
    </span>
  );
}
