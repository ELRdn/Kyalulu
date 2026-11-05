/** Disposable browser harness; not imported by the application. */
import { createRoot } from 'react-dom/client';
import { Router, createPath, type To } from 'react-router-dom';
import { ExecutionPicker } from './UnifiedEntry';

// Links inside the picker drive the app's own router through the real URL.
const href = (to: To) => typeof to === 'string' ? to : createPath(to);
const go = (to: To) => {
  if (location.pathname.startsWith('/device/') || location.protocol === 'file:') { location.hash = href(to); return; }
  history.pushState(null, '', href(to)); dispatchEvent(new PopStateEvent('popstate'));
};
const navigator = { createHref: href, push: go, replace: go, go: (delta: number) => history.go(delta) };

export function mountExecutionPicker(node:HTMLElement) {
  const root=createRoot(node);root.render(<Router location="/" navigator={navigator}><ExecutionPicker /></Router>);return root;
}
