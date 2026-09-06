import { Link } from "react-router-dom";
import Avatar from "./Avatar";
import IconButton from "./IconButton";
import "./ui.css";

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function SessionRow({
  sessionId,
  name,
  preview,
  time,
  active = false,
  pinned = false,
  onTogglePin,
}: {
  sessionId: string;
  name: string;
  preview: string | null;
  time: string | null;
  active?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  return (
    <div className={`k-session-row ${active ? "k-session-row--active" : ""}`} style={{ paddingRight: onTogglePin ? 10 : undefined }}>
      <Link to={`/chats/${encodeURIComponent(sessionId)}`} style={{ display: "flex", gap: "var(--space-3)", flex: 1, minWidth: 0, textDecoration: "none", color: "inherit" }}>
        <Avatar name={name} seed={sessionId} size="md" />
        <div className="k-session-row__body">
          <div className="k-session-row__top">
            <span className="k-session-row__name">{name}</span>
            <span className="k-session-row__time">{formatTime(time)}</span>
          </div>
          <div className="k-session-row__preview">{preview || "まだメッセージがありません"}</div>
        </div>
      </Link>
      {onTogglePin && (
        <IconButton
          label={pinned ? "ピン留めを解除" : "ピン留め"}
          active={pinned}
          size="sm"
          onClick={(e) => {
            e.preventDefault();
            onTogglePin();
          }}
        >
          📌
        </IconButton>
      )}
    </div>
  );
}
