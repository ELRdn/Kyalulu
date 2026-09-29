// Same-origin, CSP-compatible initialization before first paint.
try {
  let theme = localStorage.getItem('my-zeta-theme');
  if (theme !== 'light' && theme !== 'dark') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
} catch { /* System CSS defaults remain available when storage is disabled. */ }
