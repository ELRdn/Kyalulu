import { RuntimeImage } from '../RuntimeMedia';
import "./ui.css";

const GRADIENTS = [
  "var(--gradient-kyalulu-glow)",
  "var(--gradient-mystic-dream)",
  "var(--gradient-parallel-world)",
  "var(--gradient-tyarai-mode)",
  "var(--gradient-mint-breeze)",
];

/** id文字列から安定的にグラデーションを選ぶ（キャラクター画像が無い場合のプレースホルダー） */
export function gradientFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

export default function Avatar({
  name,
  seed,
  size = "md",
  src,
  mascot = false,
}: {
  name: string;
  seed?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  src?: string | null;
  /** 画像もキャラも無いときに Kyalulu マスコットを表示する */
  mascot?: boolean;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  // Bundled art is local; runtime portraits still use the encrypted media transport.
  const showMascot = !src && mascot;
  const image = src || (showMascot ? `${import.meta.env.BASE_URL}mascot/v1.2/face-default.png` : null);
  return (
    <span className={`k-avatar k-avatar--${size} ${image ? "k-avatar--image" : ""} ${showMascot ? "k-avatar--mascot" : ""}`} style={image ? undefined : { background: gradientFor(seed ?? name) }} aria-hidden="true">
      {image ? (showMascot ? <img src={image} alt="" loading="lazy" decoding="async" /> : <RuntimeImage src={image} alt="" loading="lazy" />) : <span className="k-avatar__initial">{initial}</span>}
    </span>
  );
}
