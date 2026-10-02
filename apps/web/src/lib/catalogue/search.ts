// Accent- and case-insensitive matching shared by the autocomplete endpoints and the directory pages.
export function normalize(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
// Rank: exact match, then prefix of the name or slug, then prefix of any word, then substring. Ties keep alphabetical order.
// The slug is searched too so that "moscow" finds Москва and "bogota" finds Bogotá.
// `aliases` adds further spellings to search (localized city names); ties still follow `name`.
export function rankMatches<T extends {name: string; slug: string}>(items: readonly T[], query: string, limit = 10, aliases?: (item: T) => readonly string[]): T[] {
  const q = normalize(query.slice(0,80));
  const sorted = [...items].sort((a,b) => a.name.localeCompare(b.name));
  if (!q) return sorted.slice(0,limit);
  const scored: {item: T; score: number}[] = [];
  for (const item of sorted) {
    const texts = [...new Set([item.name, item.slug, ...(aliases?.(item) || [])].map(normalize))];
    const score = texts.includes(q) ? 0 : texts.some(text => text.startsWith(q)) ? 1
      : texts.some(text => text.split(' ').some(word => word.startsWith(q))) ? 2 : texts.some(text => text.includes(q)) ? 3 : -1;
    if (score >= 0) scored.push({item, score});
  }
  return scored.sort((a,b) => a.score - b.score).slice(0,limit).map(entry => entry.item);
}
