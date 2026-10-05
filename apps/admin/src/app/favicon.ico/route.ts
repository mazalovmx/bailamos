// Browsers ask for /favicon.ico on every page; a small inline icon keeps the console clean.
const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#253b2f"/><text x="16" y="22" font-family="Arial" font-size="17" font-weight="700" text-anchor="middle" fill="#d9f87a">A</text></svg>';
export function GET() {
  return new Response(icon, {headers: {'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400'}});
}
