// Where to send a visitor who must sign in first: the sign-in page that returns to `path` (a path inside the locale).
export const loginPath = (locale: string, path: string) => '/' + locale + '/login?next=' + encodeURIComponent('/' + locale + path);
