// Splits plain message text into text and link parts. The UI renders parts as React text nodes and <a> elements,
// so no HTML from a message is ever interpreted. Only absolute http(s) URLs without credentials become links.
export type TextPart = {type: 'text'; value: string} | {type: 'link'; value: string; href: string};
const candidate = /https?:\/\/[^\s<>"'`]+/gi;
export function safeHref(raw: string): string | null {
  let url: URL;
  try {url = new URL(raw);} catch {return null;}
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // "https://bank.example@evil.example" style addresses are a phishing trick: never make them clickable.
  if (url.username || url.password || !url.hostname.includes('.')) return null;
  return url.href;
}
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  const push = (value: string) => {
    if (!value) return;
    const previous = parts[parts.length - 1];
    if (previous?.type === 'text') previous.value += value; else parts.push({type: 'text', value});
  };
  for (const match of text.matchAll(candidate)) {
    const start = match.index ?? 0;
    // A URL glued to a preceding word character ("xhttp://") is not treated as a link.
    if (start > 0 && /[\w]/.test(text[start - 1])) continue;
    let raw = match[0];
    while (/[.,!?;:)\]}»…]$/.test(raw)) raw = raw.slice(0, -1);
    const href = safeHref(raw);
    push(text.slice(last, start));
    if (href) parts.push({type: 'link', value: raw, href}); else push(raw);
    last = start + raw.length;
  }
  push(text.slice(last));
  return parts;
}
export const LINK_REL = 'nofollow ugc noopener';
