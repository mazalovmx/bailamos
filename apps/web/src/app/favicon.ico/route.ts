// Browsers ask for /favicon.ico whatever the page declares; the icon itself is the SVG.
export function GET(request: Request) {
  return Response.redirect(new URL('/icon.svg', request.url), 308);
}
