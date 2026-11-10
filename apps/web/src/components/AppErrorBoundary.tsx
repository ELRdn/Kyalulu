import { Component, type ReactNode } from 'react';
import './connection.css';

export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="k-connect-screen"><section className="k-connect-screen__body k-connection k-app-error">
      <img src={`${import.meta.env.BASE_URL}mascot/v2/pose-cry.webp`} alt="" width={120} height={120} style={{ justifySelf: 'center' }} />
      <h1>うまく表示できなかった…</h1>
      <button type="button" className="k-btn k-btn--primary k-btn--md" onClick={() => location.reload()}>再読み込み</button>
      <a className="k-app-error__help" href="https://kyalulu.com/docs/" target="_blank" rel="noreferrer">くり返す場合はヘルプへ</a>
    </section></main>;
  }
}
