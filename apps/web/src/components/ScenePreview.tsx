import Avatar from "./ui/Avatar";
import MessageContent from "./MessageContent";

/** キャラクター紹介ページで、最初のシーンを実際のチャットと同じ見た目でプレビューする */
export default function ScenePreview({ name, seed, portrait, content }: { name: string; seed: string; portrait?: string | null; content: string }) {
  return (
    <div className="k-scene-preview">
      <div className="k-msg k-msg--character">
        <Avatar name={name} seed={seed} size="md" src={portrait} />
        <div className="k-msg__col">
          <div className="k-msg__meta">
            <span className="k-msg__name">{name}</span>
          </div>
          <MessageContent content={content} />
        </div>
      </div>
    </div>
  );
}
