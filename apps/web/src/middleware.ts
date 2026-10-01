import createMiddleware from 'next-intl/middleware';
import {NextRequest, NextResponse} from 'next/server';
import {routing} from './i18n/routing';
const intl = createMiddleware(routing);
const origin = (value: string | undefined) => {try {return value ? new URL(value).origin : '';} catch {return '';}};
// Strict CSP: scripts run only with the per-request nonce (Next adds it to its own tags), never inline.
// Styles keep 'unsafe-inline' because MapLibre and FullCalendar position elements with inline styles.
function contentSecurityPolicy(nonce: string) {
  const dev = process.env.NODE_ENV !== 'production';
  const tiles = origin(process.env.NEXT_PUBLIC_MAP_STYLE_URL) || 'https://tiles.openfreemap.org';
  const media = [origin(process.env.S3_PUBLIC_URL), origin(process.env.S3_ENDPOINT)].filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    "script-src 'self' 'nonce-" + nonce + "' 'strict-dynamic'" + (dev ? " 'unsafe-eval'" : ''),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.cdninstagram.com https://*.fbcdn.net " + tiles + ' ' + media,
    "font-src 'self' data:",
    "connect-src 'self' " + tiles + ' ' + media + (dev ? ' ws:' : ''),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'"
  ].join('; ').replace(/\s+/g, ' ');
}
export default function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID()), csp = contentSecurityPolicy(nonce);
  // Next reads the nonce from the CSP on the REQUEST headers, so the policy travels both ways.
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  let response: NextResponse;
  // Public profiles open at /@handle and /<locale>/@handle; the page itself lives at /<locale>/people/<handle>.
  const profile = request.nextUrl.pathname.match(/^\/(?:(en|es|ru)\/)?@([a-z0-9][a-z0-9_-]{2,29})$/);
  if (profile) {
    const url = request.nextUrl.clone();
    url.pathname = '/' + (profile[1] || routing.defaultLocale) + '/people/' + profile[2];
    response = NextResponse.rewrite(url, {request: {headers}});
  } else response = intl(new NextRequest(request, {headers}));
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  return response;
}
// /e/<code> short links and files with an extension (feeds, sitemap, service worker) are not localized.
export const config = {matcher: ['/((?!api|_next|e/|.*\\..*).*)']};
