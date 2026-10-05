// Where to send a visitor who must sign in first: the sign-in page that returns to `path` (a path inside the locale).
export const loginPath = (locale: string, path: string) => '/' + locale + '/login?next=' + encodeURIComponent('/' + locale + path);
// A shared boundary for every step of authentication, including the email callback.
export function returnTarget(locale: string, next: unknown): string | undefined {
  return typeof next === 'string' && next.startsWith('/' + locale + '/') && !/[\\\s]/.test(next)
    && !next.includes('//') && next.length < 300 ? next : undefined;
}
