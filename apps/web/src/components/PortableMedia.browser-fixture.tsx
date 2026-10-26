/** Disposable browser harness; not imported by the application. */
import { createRoot } from 'react-dom/client';
import PortableMedia from './PortableMedia';
import type { PortableAsset } from '../lib/library';

export function mountPortableMedia(node:HTMLElement,assets:PortableAsset[]) {
  const root=createRoot(node);root.render(<PortableMedia assets={assets} />);return root;
}
