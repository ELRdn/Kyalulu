import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const relay = process.env.NEXT_PUBLIC_KYALULU_RELAY_ORIGIN;
  const policy = [
    "default-src 'none'", `script-src 'self' 'nonce-${nonce}'${relay ? " 'wasm-unsafe-eval'" : ''}`, "style-src 'self'",
    "style-src-attr 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
    relay ? `connect-src 'self' ${relay} ${relay.replace(/^https:/, 'wss:')}` : "connect-src 'self'",
    "worker-src 'self' blob:", "manifest-src 'self'", "media-src 'self' blob:",
    "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

// Caddy forwards page requests and the image optimizer. Static PWA documents
// and the offline entry carry their own delivery policies.
export const config = { matcher: ['/((?!_next/|device(?:/|$)|migration(?:/|$)|offline(?:/|$)).*)'] };
