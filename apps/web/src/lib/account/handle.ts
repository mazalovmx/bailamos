import {randomBytes} from 'node:crypto';
// Turns a display name into a valid handle base: 3–30 of [a-z0-9_-], starting with a letter or digit.
export function handleBase(name: string) {
  const base = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 22).replace(/-+$/, '');
  return base.length >= 3 ? base : 'dancer';
}
// Suggests a free handle for onboarding; the owner can change it in the profile editor.
export async function freeHandle(name: string, taken: (handle: string) => Promise<boolean>) {
  const base = handleBase(name);
  if (!await taken(base)) return base;
  for (let i = 0; i < 5; i++) {
    const candidate = base + '-' + randomBytes(3).toString('hex');
    if (!await taken(candidate)) return candidate;
  }
  return base + '-' + randomBytes(3).toString('hex');
}
