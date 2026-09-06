import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { fetchCharacters, fetchWorlds, type CharacterInfo, type WorldInfo } from "../lib/api";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import { moodLabelFor } from "../lib/moodTaxonomy";
import { startNewSession } from "../lib/session";
import "./pages.css";
import "./characterEntry.css";

const GRADIENTS = ["var(--gradient-kyalulu-glow)", "var(--gradient-mystic-dream)", "var(--gradient-parallel-world)", "var(--gradient-tyarai-mode)", "var(--gradient-mint-breeze)"];
function gradientFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

export default function CharacterEntry() {
  const { characterId } = useParams<{ characterId: string }>();
  const navigate = useNavigate();
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    Promise.all([fetchCharacters(true).catch(() => []), fetchWorlds().catch(() => [])])
      .then(([c, w]) => {
        setCharacters(c);
        setWorlds(w);
      })
      .finally(() => setLoading(false));
  }, []);

  const character = characters.find((c) => c.id === characterId) as any;

  const handleStart = async () => {
    if (!character) return;
    setStarting(true);
    setError(null);
    try {
      const sessionId = await startNewSession({ characterId: character.id, intro: character.intro ?? "" });
      navigate(`/chats/${encodeURIComponent(sessionId)}`);
    } catch (e) {
      setError(`会話を作成できませんでした: ${String(e)}`);
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="k-page">
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>読み込み中...</div>
      </div>
    );
  }

  if (!character) {
    return (
      <div className="k-page">
        <EmptyState
          motif="✧"
          title="キャラクターが見つかりません"
          description="削除されたか、URLが間違っている可能性があります。"
          action={<Button variant="secondary" onClick={() => navigate("/discover")}>Discoverへ戻る</Button>}
        />
      </div>
    );
  }

  const tags: string[] = character.tags ?? [];

  return (
    <div className="k-page" style={{ maxWidth: 960 }}>
      <div className="k-char-entry">
        <div className="k-char-entry__art" style={{ background: gradientFor(character.id) }}>
          {character.display_name.trim().charAt(0)}
        </div>
        <div className="k-char-entry__body">
          <h1 className="k-char-entry__name">{character.display_name}</h1>
          <div className="k-char-entry__meta">by {character.official ? "Kyalulu Official · SFW" : "Local"}</div>
          <p className="k-char-entry__hook">{character.description}</p>
          {tags.length > 0 && (
            <div className="k-char-entry__tags">
              {tags.map((t) => {
                const m = moodLabelFor(t);
                return (
                  <Badge key={t} tone="accent">
                    {m.icon && <span aria-hidden="true">{m.icon}</span>} {m.label}
                  </Badge>
                );
              })}
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          <Button variant="primary" size="lg" onClick={handleStart} disabled={starting} style={{ marginTop: 8, width: "fit-content" }}>
            {starting ? "準備中..." : "Start Chat ✦"}
          </Button>
        </div>
      </div>

      {character.intro && (
        <section className="k-section">
          <h2 className="k-section__title">✦ Intro</h2>
          <div className="k-card-plain">{character.intro}</div>
        </section>
      )}

      {worlds.length > 0 && (
        <section className="k-section">
          <h2 className="k-section__title">✦ ワールド候補</h2>
          <div className="k-chip-row">
            {worlds.map((w) => (
              <Link key={w.id} to={`/discover?world=${encodeURIComponent(w.id)}`} className="k-chip" style={{ textDecoration: "none" }}>
                {w.display_name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
