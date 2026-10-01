// Pure partner-search rules: no database, no clock other than the `now` argument. Unit-tested in tests/matching.test.ts.
export const LEVELS = ['NEWCOMER', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'PRO'] as const;
export const ROLES = ['LEADER', 'FOLLOWER', 'BOTH'] as const;
export type Level = typeof LEVELS[number];
export type Role = typeof ROLES[number];
export const levelIndex = (level: string) => LEVELS.indexOf(level as Level);
export const levelGap = (a: string, b: string) => Math.abs(levelIndex(a) - levelIndex(b));
/** A leader dances with a follower; BOTH dances with anyone. Two leaders or two followers are not a pair. */
export function rolesCompatible(mine: string, theirs: string) {
  return mine === 'BOTH' || theirs === 'BOTH' || mine !== theirs;
}
/** 1 for an exact complementary pair, 0.7 when either side switches roles, 0 for an incompatible pair. */
export function roleFit(mine: string, theirs: string) {
  if (!rolesCompatible(mine, theirs)) return 0;
  return mine !== 'BOTH' && theirs !== 'BOTH' ? 1 : 0.7;
}
// Upper bounds in kilometres. A band is the only form in which a distance ever leaves the server.
export const BAND_LIMITS = [5, 10, 25, 50, 100] as const;
export const BANDS = ['LT5', '5_10', '10_25', '25_50', '50_100', 'GT100'] as const;
export type Band = typeof BANDS[number];
export function distanceBand(metres: number | null | undefined): Band | null {
  if (metres === null || metres === undefined || !Number.isFinite(metres) || metres < 0) return null;
  const index = BAND_LIMITS.findIndex(limit => metres < limit * 1000);
  return BANDS[index < 0 ? BANDS.length - 1 : index];
}
export const WEIGHTS = {level: 30, role: 25, distance: 20, activity: 20, shared: 5} as const;
const LEVEL_POINTS = [1, 2 / 3, 1 / 4];
const BAND_POINTS: Record<Band, number> = {LT5: 1, '5_10': 0.85, '10_25': 0.65, '25_50': 0.4, '50_100': 0.2, GT100: 0};
const HALF_LIFE_DAYS = 14;
export type ScoreInput = {levelGap: number; roleFit: number; band: Band | null; lastActiveAt: Date | null; sharedStyles: number};
/** Activity freshness in 0..1: halves every two weeks; a profile that was never active scores 0. */
export function freshness(lastActiveAt: Date | null, now: Date) {
  if (!lastActiveAt) return 0;
  const days = Math.max(0, now.getTime() - lastActiveAt.getTime()) / 86400000;
  return Math.pow(0.5, days / HALF_LIFE_DAYS);
}
/** 0..100, higher is better. Rounded to two decimals so that equal inputs always give equal scores. */
export function score(input: ScoreInput, now: Date): number {
  const total = WEIGHTS.level * (LEVEL_POINTS[Math.max(0, Math.round(input.levelGap))] ?? 0)
    + WEIGHTS.role * Math.max(0, Math.min(1, input.roleFit))
    + WEIGHTS.distance * (input.band ? BAND_POINTS[input.band] : 0)
    + WEIGHTS.activity * freshness(input.lastActiveAt, now)
    + WEIGHTS.shared * Math.min(Math.max(0, input.sharedStyles), 3) / 3;
  return Math.round(total * 100) / 100;
}
/** Best first; equal scores are ordered by id (plain code-unit comparison), so the order never depends on input order. */
export function rank<T extends {id: string; score: number}>(items: T[]): T[] {
  return [...items].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
