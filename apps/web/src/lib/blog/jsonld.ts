type Author = {name: string; handle: string; type: string};
export type JsonLdPost = {title: string; excerpt: string | null; publishedAt: Date; updatedAt: Date; profile: Author;
  event?: {title: string; slug: string; startsAt: Date} | null};
// Schema.org BlogPosting. Only what the page shows publicly goes in.
export function postJsonLd(post: JsonLdPost, links: {origin: string; url: string; locale: string; image?: string}) {
  const organization = ['SCHOOL', 'ORGANIZER', 'VENUE'].includes(post.profile.type);
  return {
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title.slice(0, 110), url: links.url,
    mainEntityOfPage: {'@type': 'WebPage', '@id': links.url},
    datePublished: post.publishedAt.toISOString(), dateModified: (post.updatedAt > post.publishedAt ? post.updatedAt : post.publishedAt).toISOString(),
    author: {'@type': organization ? 'Organization' : 'Person', name: post.profile.name, url: links.origin + '/@' + post.profile.handle},
    ...(post.excerpt ? {description: post.excerpt} : {}),
    ...(links.image ? {image: [links.image]} : {}),
    ...(post.event ? {about: {'@type': 'Event', name: post.event.title, startDate: post.event.startsAt.toISOString(),
      url: links.origin + '/' + links.locale + '/events/' + post.event.slug}} : {})
  };
}
// Safe inside <script type="application/ld+json">: no "<" survives, so user text cannot close the element.
// The two Unicode line separators are escaped too: legal in JSON, but a line end for older script parsers.
const backslash = String.fromCharCode(92);
const separators = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
export const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, backslash + 'u003c')
  .replace(separators, char => backslash + 'u' + char.charCodeAt(0).toString(16));
