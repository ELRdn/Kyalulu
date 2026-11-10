import Avatar from "./ui/Avatar";
import MessageContent, { Narration } from "./MessageContent";
import { splitLeadingScene } from "../lib/text";

/** The opening scene, drawn exactly like the start of a chat. */
export default function ScenePreview({ name, seed, portrait, content }: { name: string; seed: string; portrait?: string | null; content: string }) {
  const [scene, rest] = splitLeadingScene(content);
  return (
    <div className="k-scene-preview">
      {scene && <Narration><p>{scene}</p></Narration>}
      {rest && <div className="k-msg k-msg--character">
        <Avatar name={name} seed={seed} size="sm" src={portrait} />
        <div className="k-msg__col">
          <div className="k-msg__meta">
            <span className="k-msg__name">{name}</span>
          </div>
          <MessageContent content={rest} />
        </div>
      </div>}
    </div>
  );
}
