import {mediaUrl} from './media';
const schemaType = {DANCER: 'Person', ARTIST: 'Person', ORGANIZER: 'Organization', SCHOOL: 'DanceSchool', VENUE: 'Place'} as const;
type PublicProfile = {type: keyof typeof schemaType; handle: string; name: string; bio: string | null; instagram: string | null;
  avatarKey: string | null; district: string | null; city: {name: string; countryCode: string} | null};
// Only public fields go in: city and district, never coordinates or email.
export function profileJsonLd(profile: PublicProfile, origin: string) {
  const type = schemaType[profile.type];
  const address = profile.city ? {'@type': 'PostalAddress', addressLocality: profile.city.name,
    addressCountry: profile.city.countryCode, ...(profile.district ? {addressRegion: profile.district} : {})} : undefined;
  return {
    '@context': 'https://schema.org', '@type': type, name: profile.name, url: origin + '/@' + profile.handle,
    ...(type !== 'Place' ? {alternateName: '@' + profile.handle} : {}),
    ...(profile.bio ? {description: profile.bio.slice(0, 300)} : {}),
    ...(profile.avatarKey ? {image: origin + mediaUrl(profile.avatarKey)} : {}),
    ...(profile.instagram ? {sameAs: ['https://www.instagram.com/' + profile.instagram + '/']} : {}),
    ...(address ? {[type === 'Person' ? 'homeLocation' : 'address']: type === 'Person' ? {'@type': 'Place', address} : address} : {})
  };
}
// Safe inside <script type="application/ld+json">: no "<" survives, so user text cannot close the element.
const escapedLt = String.fromCharCode(92) + 'u003c';
export const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, escapedLt);
