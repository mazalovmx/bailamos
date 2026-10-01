import {randomBytes} from 'node:crypto';
const CYRILLIC: Record<string, string> = {а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'};
/** URL part made from a title: ASCII letters, digits and single hyphens, at most 60 characters; "post" when nothing is left. */
export function slugBase(title: string) {
  const ascii = title.toLowerCase().replace(/[а-яё]/g, letter => CYRILLIC[letter] ?? '').replace(/ß/g, 'ss').replace(/ñ/g, 'n')
    .normalize('NFKD').replace(/\p{M}/gu, '');
  return ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'post';
}
export const randomSuffix = () => randomBytes(4).toString('hex');
/** The base itself, then base-2 … base-9, then a random suffix. `taken` answers whether a slug is already in use. */
export async function uniqueSlug(title: string, taken: (slug: string) => Promise<boolean>) {
  const base = slugBase(title);
  if (!await taken(base)) return base;
  for (let n = 2; n < 10; n++) if (!await taken(base + '-' + n)) return base + '-' + n;
  return base + '-' + randomSuffix();
}
