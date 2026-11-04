import { Component, type ReactNode } from 'react';
import './connection.css';

export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="k-connect-screen"><section className="k-connect-screen__body k-connection">
      <img src={`${import.meta.env.BASE_URL}mascot/v2/pose-cry.webp`} alt="" width={160} height={160} style={{ justifySelf: 'center' }} />
      <h1>画面を開けませんでした</h1>
      <p>アプリを更新した直後の場合は、再読み込みしてください。サーバーに保存された会話はそのまま残っています。</p>
      <button type="button" className="k-btn k-btn--primary k-btn--md" onClick={() => location.reload()}>再読み込み</button>
    </section></main>;
  }
}
