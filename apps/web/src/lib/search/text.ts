// Pure text helpers of the site search: query clean-up, accent folding, tsquery building and safe highlighting.
// Nothing here produces HTML: highlights are plain-text segments that React escapes when rendering.
export const MIN_QUERY = 2, MAX_QUERY = 100, MAX_WORDS = 8;
export type Segment = {text: string; hit?: true};
// NFC, control characters removed, whitespace collapsed, bounded length.
export function cleanQuery(raw: string): string {
  return raw.normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY).trim();
}
// Lower case without diacritics: "Málaga" -> "malaga", "Ёлка" -> "елка". «й» is a letter of its own and is kept.
export function fold(text: string): string {
  let out = '';
  for (const char of text.normalize('NFC').toLowerCase()) out += char === 'й' ? char : char.normalize('NFD').replace(/\p{M}+/gu, '');
  return out;
}
const wordPattern = /[\p{L}\p{N}\p{M}]+/gu;
// Distinct lower-case words of the query, letters and digits only, so they are safe operands for to_tsquery.
export function queryWords(query: string): string[] {
  const words = (cleanQuery(query).toLowerCase().match(wordPattern) || []).map(word => word.replace(/\p{M}+/gu, '').slice(0, 40)).filter(Boolean);
  return [...new Set(words)].slice(0, MAX_WORDS);
}
// A query is searchable once it holds a word of at least MIN_QUERY letters or digits.
export const searchable = (query: string) => queryWords(query).some(word => [...word].length >= MIN_QUERY);
// Quoted phrases, exclusions and OR are left entirely to websearch_to_tsquery.
export const isAdvanced = (query: string) => /"|(^|\s)-[\p{L}\p{N}]|\sor\s/iu.test(query);
const accents: Record<string, string> = {a: 'áàâãäå', e: 'éèêëěę', i: 'íìîï', o: 'óòôõöő', u: 'úùûüůű', y: 'ý', n: 'ñń', c: 'çčć', s: 'šś', z: 'žźż', l: 'ł', 'е': 'ё'};
// The word as typed, without diacritics, and with one diacritic put on each letter in turn: "malaga" also yields "málaga".
// The index uses the 'simple' configuration (no unaccent), so accent-insensitivity comes from this expansion.
export function accentVariants(word: string, limit = 48): string[] {
  const base = [...fold(word)], out = new Set([word, base.join('')]);
  for (let i = 0; i < base.length; i++) for (const variant of accents[base[i]] || '') {
    if (out.size >= limit) return [...out];
    out.add(base.slice(0, i).join('') + variant + base.slice(i + 1).join(''));
  }
  return [...out];
}
// Operand string for to_tsquery('simple', …): every word must be present in some accent variant; the last word, the one
// still being typed, matches as a prefix. Built only from letters and digits; returns '' when no word is long enough.
export function prefixTsQuery(query: string): string {
  const words = queryWords(query).filter(word => [...word].length >= MIN_QUERY);
  return words.map((word, index) => '(' + accentVariants(word).map(variant => variant + (index === words.length - 1 ? ':*' : '')).join(' | ') + ')').join(' & ');
}
const foldedWords = (query: string) => [...new Set(queryWords(query).map(fold))];
function isHit(word: string, needles: readonly string[]) {
  const folded = fold(word);
  return needles.some(needle => [...needle].length >= MIN_QUERY ? folded.startsWith(needle) : folded === needle);
}
// Splits text into segments, marking the words that start with a query word (case- and accent-insensitive).
export function highlight(text: string, query: string): Segment[] {
  const needles = foldedWords(query), segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(wordPattern)) {
    if (!isHit(match[0], needles)) continue;
    if (match.index > last) segments.push({text: text.slice(last, match.index)});
    segments.push({text: match[0], hit: true});
    last = match.index + match[0].length;
  }
  if (last < text.length || !segments.length) segments.push({text: text.slice(last)});
  return segments;
}
// A window of about `size` characters around the first matching word (or the beginning of the text), highlighted.
export function snippet(text: string | null | undefined, query: string, size = 180): Segment[] | null {
  const flat = (text || '').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  const needles = foldedWords(query);
  let at = 0;
  for (const match of flat.matchAll(wordPattern)) if (isHit(match[0], needles)) {at = match.index; break;}
  let start = Math.max(0, at - Math.floor(size / 3));
  if (start > 0) {const space = flat.indexOf(' ', start); start = space >= 0 && space < at ? space + 1 : at;}
  let end = Math.min(flat.length, start + size);
  if (end < flat.length) {const space = flat.lastIndexOf(' ', end); if (space > start + size / 2) end = space;}
  return highlight((start > 0 ? '… ' : '') + flat.slice(start, end) + (end < flat.length ? ' …' : ''), query);
}
