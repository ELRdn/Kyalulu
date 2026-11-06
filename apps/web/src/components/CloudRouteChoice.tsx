import { useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import CloudLogin from './CloudLogin';
import { consumeLoginReturn, guestReadableRoute, readLoginReturn, rememberLoginReturn, safeLoginReturn, unknownRoute } from '../lib/cloudGuest';
import { useLanguage } from '../lib/appContext';

/** Keep public browsing available while private routes require a real account. */
export default function CloudRouteChoice({ authenticated, children }: { authenticated: boolean; children: ReactNode }) {
  const en=useLanguage()==='en';
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const login = location.pathname === '/login' || params.has('login_error');
  const gated = !guestReadableRoute(location.pathname) && !unknownRoute(location.pathname);
  const returnTo = safeLoginReturn(params.get('returnTo') ?? (login ? readLoginReturn() : location.pathname + location.search));
  useEffect(() => {
    if (authenticated && (login || location.pathname === '/')) {
      const target = consumeLoginReturn(returnTo);
      if (login || target !== '/') navigate(target, { replace: true });
    } else if (!authenticated && !login && gated) {
      rememberLoginReturn(returnTo);
    }
  }, [authenticated, login, gated, location.pathname, returnTo, navigate]);
  if (login || (!authenticated && gated)) {
    return authenticated ? <p role="status">{en?'Returning to your previous page…':'元の画面へ戻っています…'}</p> : <CloudLogin returnTo={returnTo} />;
  }
  return children;
}
