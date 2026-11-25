export function ChatPending({ english }: { english: boolean }) {
  return <div className="online-character" role="status">
    {english ? 'Loading chat…' : 'チャットを読み込んでいます…'}
  </div>;
}
