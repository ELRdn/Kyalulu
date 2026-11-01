/** Disposable UI mount; never imported by the application. */
import { createRoot } from 'react-dom/client';
import SessionPolicy from '../../apps/web/src/components/SessionPolicy';
export function mountSessionPolicy(node:HTMLElement,sessionId:string) {
  const root=createRoot(node);root.render(<SessionPolicy sessionId={sessionId} model="fictional" disabled={false}/>);return root;
}
