export const eventKinds=['CLASS','WORKSHOP','MASTERCLASS','INTENSIVE','PRACTICE','SOCIAL','FESTIVAL','OTHER'] as const;
export const danceFormats=['SOLO','PARTNER','MIXED','UNSPECIFIED'] as const;
export const classLevels=['OPEN','NEWCOMER','BEGINNER','IMPROVER','INTERMEDIATE','ADVANCED','PRO','UNSPECIFIED'] as const;
export const intensities=['RELAXED','MODERATE','ENERGETIC','UNSPECIFIED'] as const;
export const tempos=['SLOW','MEDIUM','FAST','VARIED','UNSPECIFIED'] as const;
export const swingStyles=['swing','lindy-hop','solo-jazz','balboa','pure-balboa','bal-swing','collegiate-shag','st-louis-shag','carolina-shag','charleston','solo-charleston','partner-charleston','boogie-woogie','east-coast-swing','west-coast-swing'];
export function styleFamily(id:string) {
  if(id==='swing') return swingStyles;
  if(id==='charleston') return ['charleston','solo-charleston','partner-charleston'];
  if(id==='balboa') return ['balboa','pure-balboa','bal-swing'];
  return [id];
}
