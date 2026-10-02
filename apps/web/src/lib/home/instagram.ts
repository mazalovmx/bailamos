// Instagram posts featured on the homepage. They are shown through Instagram's own embed page in a frame:
// nothing is copied to our storage and no Meta script runs in our page.
// HOME_INSTAGRAM_URLS (comma- or space-separated post/reel links) replaces the default list without a code change.
const featured = [
  'https://www.instagram.com/p/Dd9Pp0MFK04/',
  'https://www.instagram.com/p/DaQnnWimpwf/',
  'https://www.instagram.com/reel/DUTyWxugWgV/',
  'https://www.instagram.com/reel/DdpG5aRNiIu/',
  'https://www.instagram.com/p/Dd4KD7ol-Pb/'
];
const POST = /^https:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9._]{1,30}\/)?(p|reel|tv)\/([A-Za-z0-9_-]{5,40})(?:[/?#]|$)/;
export type FeaturedPost = {code: string; permalink: string; embedUrl: string};
// Only links to a single post or reel are accepted; tracking parameters are dropped and duplicates removed.
export function featuredPosts(source = process.env.HOME_INSTAGRAM_URLS): FeaturedPost[] {
  const links = source?.trim() ? source.split(/[\s,]+/) : featured, posts = new Map<string, FeaturedPost>();
  for (const link of links) {
    const match = POST.exec(link.trim());
    if (!match) continue;
    const permalink = 'https://www.instagram.com/' + match[1] + '/' + match[2] + '/';
    posts.set(match[2], {code: match[2], permalink, embedUrl: permalink + 'embed/'});
  }
  return [...posts.values()].slice(0, 5);
}
