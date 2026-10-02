// A short, human name for the browser and system of a session. Product names are not translated; null means "unknown device".
export function describeAgent(userAgent?: string | null) {
  const ua = (userAgent || '').slice(0, 400);
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  const system = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux|X11|CrOS/.test(ua) ? 'Linux' : '';
  return [browser, system].filter(Boolean).join(' · ') || null;
}
