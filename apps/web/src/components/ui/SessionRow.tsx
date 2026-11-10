import { Link } from "react-router-dom";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { sessionTitle, type SessionInfo } from "../../lib/api";
import { cleanPreview, splitLeadingScene } from "../../lib/text";
import "./ui.css";
import { useLanguage } from '../../lib/appContext';

export default function SessionRow({
  session,
  worldName,
  active = false,
  pinned = false,
  onTogglePin,
  onDelete,
}: {
  session: SessionInfo;
  worldName?: string;
  active?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
  onDelete?: () => void;
}) {
  const language = useLanguage(), en = language === 'en';
  const name = sessionTitle(session, language);
  // Show the character's last line, not the opening scene above it (design 06).
  const preview = cleanPreview(splitLeadingScene(session.last_preview ?? '')[1] || session.last_preview);
  return (
    <div className={`k-session-row ${active ? "k-session-row--active" : ""}`}>
      <Link to={`/chats/${encodeURIComponent(session.session_id)}`} className="k-session-row__link" aria-current={active ? "page" : undefined}>
        <Avatar name={name} seed={session.character_id ?? session.session_id} size="md" src={session.portrait_url} mascot={!session.character_name} />
        <div className="k-session-row__body">
          <div className="k-session-row__top">
            <span className="k-session-row__name">{name}</span>
            {pinned && <Icon name="pin" size={14} className="k-session-row__pinned" />}
          </div>
          <div className="k-session-row__preview">{preview || (en ? 'No messages yet' : 'まだメッセージがありません')}</div>
          {session.sync_copy && <div className="k-session-row__world">{en ? 'Synced copy' : '同期コピー'} · v{session.sync_copy.revision}</div>}
          {session.sync_recovery && <div className="k-session-row__world">{en ? 'Recovered local edits' : '未同期の変更を保護'}</div>}
          {session.offline_available === false && <div className="k-session-row__world">{en ? 'Connect to reopen' : '再取得には接続が必要'}</div>}
          {worldName && <div className="k-session-row__world">✦ {worldName}</div>}
        </div>
      </Link>
      {onTogglePin && (
        <div className="k-session-row__actions"><button
          type="button"
          className={`k-session-row__pin ${pinned ? "is-pinned" : ""}`}
          aria-label={pinned ? (en ? `Unpin ${name}` : `${name}のピン留めを解除`) : (en ? `Pin ${name}` : `${name}をピン留め`)}
          aria-pressed={pinned}
          title={pinned ? (en ? 'Unpin' : 'ピン留めを解除') : (en ? 'Pin' : 'ピン留め')}
          onClick={onTogglePin}
        >
          <Icon name="pin" size={18} />
          <span>{pinned ? (en ? 'Unpin' : '解除') : (en ? 'Pin' : 'ピン留め')}</span>
        </button>
        {onDelete && <button type="button" className="k-session-row__pin k-session-row__delete" aria-label={en ? `Delete the conversation with ${name}` : `${name}との会話を削除`} onClick={onDelete}>
          <Icon name="trash" size={18} />
          <span>{en ? 'Delete' : '削除'}</span>
        </button>}</div>
      )}
    </div>
  );
}
