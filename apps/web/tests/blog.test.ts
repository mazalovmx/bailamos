import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {config} from 'dotenv';
config({path: '../../.env', quiet: true});
import React, {createElement} from 'react';
// tsx compiles JSX in the classic way (tsconfig "jsx": "preserve"), which expects a global React; Next.js itself does not need this.
Object.assign(globalThis, {React});
import {renderToStaticMarkup} from 'react-dom/server';
import Parser from 'rss-parser';
import {ContentError, MAX_CONTENT_CHARS, parseContent, type PostMedia} from '../src/lib/blog/content';
import {cleanContent, excerptOf, firstImage, isEmptyDoc, safeHref, withoutImages} from '../src/lib/blog/nodes';
import {renderContent, type ImageProps, type InstagramProps} from '../src/lib/blog/render';
import {slugBase, uniqueSlug} from '../src/lib/blog/slug';
import {canPost, postAbility} from '../src/lib/blog/permissions';
import {buildRss, etagOf, rssResponse, xmlEscape} from '../src/lib/blog/rss';
import {postJsonLd, safeJson} from '../src/lib/blog/jsonld';
import {afterCursor, compareFeed, decodeCursor, encodeCursor, mergeFeed, type FeedItem} from '../src/lib/feed/cursor';
const KEY = 'img/profile1/3f2b8c1e-7a4d-4e2b-9c1a-5d6e7f8a9b0c';
const media = new Map<string, PostMedia>([['m1', {storageKey: KEY, width: 1200, height: 800}]]);
const p = (...content: unknown[]) => ({type: 'paragraph', content});
const text = (value: string, marks?: unknown[]) => ({type: 'text', text: value, ...(marks ? {marks} : {})});
const doc = (...content: unknown[]) => ({type: 'doc', content});
const link = (href: string) => ({type: 'link', attrs: {href}});
const image = (attrs: Record<string, unknown> = {}) => ({type: 'image', attrs: {mediaId: 'm1', storageKey: KEY, alt: 'Dancers on the floor', ...attrs}});
const instagram = {type: 'instagram', attrs: {permalink: 'https://www.instagram.com/p/CxYz12345/', author: 'swing.anna', title: 'Festival night'}};
const full = doc(
  {type: 'heading', attrs: {level: 2}, content: [text('Herräng 2030')]},
  p(text('It was '), text('great', [{type: 'bold'}, {type: 'italic'}]), {type: 'hardBreak'}, text('more here', [link('https://example.com/a?b=1&c=2')])),
  {type: 'bulletList', content: [{type: 'listItem', content: [p(text('one'))]}]},
  {type: 'orderedList', attrs: {start: 3}, content: [{type: 'listItem', content: [p(text('three'))]}]},
  {type: 'blockquote', content: [p(text('quote'))]},
  image(), instagram, {type: 'heading', attrs: {level: 3}, content: [text('Notes')]}, p(text('mail', [link('mailto:anna@example.com')])), {type: 'paragraph'});
const code = (input: unknown, items = media) => {
  try {parseContent(input, items); return 'OK';} catch (error) {return error instanceof ContentError ? error.code : 'THROWN';}
};
test('content schema accepts every supported block and takes image facts from the database', () => {
  const lied = doc(image({storageKey: 'img/other/3f2b8c1e-7a4d-4e2b-9c1a-5d6e7f8a9b0d', width: 5, height: 5}));
  assert.equal(code(full), 'OK');
  const stored = firstImage(parseContent(lied, media));
  assert.deepEqual([stored?.storageKey, stored?.width, stored?.height], [KEY, 1200, 800]);
  assert.equal(code(doc()), 'OK');
});
test('content schema rejects scripts, unsafe links, foreign media and anything unknown', () => {
  const bad: [string, unknown][] = [
    ['script node', doc({type: 'script', content: [text('alert(1)')]})],
    ['html node', doc({type: 'html', attrs: {html: '<script>alert(1)</script>'}})],
    ['iframe node', doc({type: 'iframe', attrs: {src: 'https://evil.example'}})],
    ['javascript link', doc(p(text('x', [link('javascript:alert(1)')])))],
    ['obfuscated javascript link', doc(p(text('x', [link(' JaVaScRiPt:alert(1)')])))],
    ['tabbed javascript link', doc(p(text('x', [link('java\tscript:alert(1)')])))],
    ['data link', doc(p(text('x', [link('data:text/html,<script>alert(1)</script>')])))],
    ['vbscript link', doc(p(text('x', [link('vbscript:msgbox(1)')])))],
    ['relative link', doc(p(text('x', [link('/admin')])))],
    ['protocol-relative link', doc(p(text('x', [link('//evil.example')])))],
    ['link with credentials', doc(p(text('x', [link('https://user:pass@example.com/')])))],
    ['extra link attribute', doc(p(text('x', [{type: 'link', attrs: {href: 'https://example.com', onclick: 'alert(1)'}}])))],
    ['unknown mark', doc(p(text('x', [{type: 'code'}])))],
    ['unknown node', doc({type: 'codeBlock', content: [text('x')]})],
    ['unknown attribute', doc({type: 'paragraph', attrs: {style: 'color:red'}, content: [text('x')]})],
    ['extra node field', doc({type: 'paragraph', content: [text('x')], onclick: 'alert(1)'})],
    ['heading level 1', doc({type: 'heading', attrs: {level: 1}, content: [text('x')]})],
    ['image with src', doc(image({src: 'https://evil.example/x.png'}))],
    ['image without alt', doc(image({alt: '  '}))],
    ['image with a bad key', doc(image({storageKey: '../../etc/passwd'}))],
    ['instagram profile link', doc({type: 'instagram', attrs: {permalink: 'https://www.instagram.com/swing.anna/'}})],
    ['instagram on another host', doc({type: 'instagram', attrs: {permalink: 'https://evil.example/p/CxYz12345/'}})],
    ['instagram thumbnail elsewhere', doc({type: 'instagram', attrs: {permalink: instagram.attrs.permalink, thumbnailUrl: 'https://evil.example/x.jpg'}})],
    ['not a doc', p(text('x'))], ['null', null], ['string', '<script>alert(1)</script>'], ['empty text', doc(p(text('')))],
    ['block inside a paragraph', doc(p(p(text('x'))))]
  ];
  for (const [name, input] of bad) assert.equal(code(input), 'INVALID_CONTENT', name);
  // Media of another post (or a deleted item) is not in the map of this post.
  assert.equal(code(doc(image({mediaId: 'someone-elses'}))), 'FOREIGN_MEDIA');
  assert.equal(code(doc(image()), new Map()), 'FOREIGN_MEDIA');
  assert.equal(code(doc(image()), new Map([['m1', {storageKey: null, width: null, height: null}]])), 'FOREIGN_MEDIA');
  // Size and shape limits.
  assert.equal(code(doc(...Array.from({length: 9}, () => p(text('x'.repeat(19000)))))), 'CONTENT_TOO_LARGE');
  assert.ok(JSON.stringify(full).length < MAX_CONTENT_CHARS);
  let deep: unknown = p(text('x'));
  for (let i = 0; i < 30; i++) deep = {type: 'blockquote', content: [deep]};
  assert.equal(code(doc(deep)), 'INVALID_CONTENT');
  assert.equal(code(doc(...Array.from({length: 4100}, () => ({type: 'paragraph'})))), 'INVALID_CONTENT');
});
test('editor output is reduced to stored attributes; link checks and summaries', () => {
  const fromEditor = doc(
    {type: 'paragraph', attrs: {textAlign: null}, content: [text('x', [{type: 'link', attrs: {href: 'https://example.com/', target: '_blank', rel: 'noopener', class: null}}])]},
    {type: 'orderedList', attrs: {start: 1, type: null}, content: [{type: 'listItem', content: [p(text('a'))]}]},
    {type: 'instagram', attrs: {permalink: instagram.attrs.permalink, author: null, title: null, thumbnailUrl: null}});
  assert.equal(code(fromEditor), 'INVALID_CONTENT');
  const cleaned = cleanContent(fromEditor);
  assert.equal(code(cleaned), 'OK');
  assert.equal(JSON.stringify(cleaned).includes('target'), false);
  assert.equal(safeHref(' https://example.com/a?b=1 '), 'https://example.com/a?b=1');
  assert.equal(safeHref('mailto:anna@example.com'), 'mailto:anna@example.com');
  for (const href of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', '/local', '', 'https://example.com/a b', 'ftp://example.com', 'https://', null, 42]) assert.equal(safeHref(href), null, String(href));
  assert.equal(excerptOf(full).startsWith('Herräng 2030 It was great more here one three quote'), true);
  assert.ok(excerptOf(doc(p(text('word '.repeat(200)))), 100).length <= 101);
  assert.equal(isEmptyDoc(doc({type: 'paragraph'}, p(text('   ')))), true);
  assert.equal(isEmptyDoc(doc(image())), false);
  assert.equal(firstImage(withoutImages(full, new Set(['m1']))), null);
});
const Image = ({storageKey, alt}: ImageProps) => createElement('img', {src: '/api/media/file/' + storageKey + '/800.webp', alt});
const Instagram = ({permalink, meta}: InstagramProps) => createElement('a', {href: permalink, rel: 'nofollow ugc noopener'}, meta.author || 'Instagram');
const html = (input: unknown) => renderToStaticMarkup(createElement('div', null, renderContent(input, {Image, Instagram})));
test('renderer escapes text, marks user links nofollow ugc and ignores what it does not know', () => {
  const out = html(parseContent(full, media));
  assert.ok(out.includes('<a href="https://example.com/a?b=1&amp;c=2" rel="nofollow ugc noopener">more here</a>'));
  assert.ok(out.includes('<h2>Herräng 2030</h2>') && out.includes('<h3>Notes</h3>') && out.includes('<strong><em>great</em></strong>'));
  assert.ok(out.includes('<ol start="3"><li><p>three</p></li></ol>') && out.includes('<blockquote><p>quote</p></blockquote>') && out.includes('<br/>'));
  assert.ok(out.includes('alt="Dancers on the floor"') && out.includes(KEY));
  assert.ok(out.includes('href="https://www.instagram.com/p/CxYz12345/"'));
  const anchors = out.match(/<a [^>]*>/g) || [];
  assert.equal(anchors.length, 3);
  for (const anchor of anchors) assert.ok(anchor.includes('rel="nofollow ugc noopener"'), anchor);
  // A hostile document that somehow reached storage still renders harmlessly.
  const hostile = html(doc(
    p(text('<script>alert(1)</script>'), text('click', [link('javascript:alert(1)')]), text('"><img src=x onerror=alert(1)>')),
    {type: 'script', content: [text('alert(2)')]}, {type: 'html', attrs: {html: '<b>x</b>'}},
    {type: 'instagram', attrs: {permalink: 'https://evil.example/p/abcde/'}}, {type: 'image', attrs: {src: 'https://evil.example/x.png'}}));
  assert.equal(/<script|<img|<a |<b>|javascript:|evil\.example/.test(hostile), false, hostile);
  assert.ok(hostile.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && hostile.includes('click'));
  assert.equal(html(null), '<div></div>');
  assert.equal(html({type: 'paragraph'}), '<div></div>');
  // The renderer source never injects HTML.
  for (const file of ['../src/lib/blog/render.tsx', '../src/components/blog/post-body.tsx'])
    assert.equal(readFileSync(new URL(file, import.meta.url), 'utf8').includes('dangerouslySetInnerHTML'), false, file);
});
test('slugs are ASCII, bounded and unique', async () => {
  assert.equal(slugBase('  Herräng 2030: ¡Qué noche! '), 'herrang-2030-que-noche');
  assert.equal(slugBase('Отчёт о фестивале'), 'otchet-o-festivale');
  assert.equal(slugBase('Mañana & straße'), 'manana-strasse');
  assert.equal(slugBase('!!! ???'), 'post');
  assert.equal(slugBase('日本語'), 'post');
  assert.ok(slugBase('a'.repeat(50) + ' ' + 'b'.repeat(50)).length <= 60);
  assert.match(slugBase('x'.repeat(59) + ' y'), /^[a-z0-9]+(-[a-z0-9]+)*$/);
  const taken = new Set(['my-post', 'my-post-2']);
  assert.equal(await uniqueSlug('My post', async slug => taken.has(slug)), 'my-post-3');
  assert.equal(await uniqueSlug('Other', async slug => taken.has(slug)), 'other');
  assert.match(await uniqueSlug('Busy', async () => true), /^busy-[0-9a-f]{8}$/);
});
test('only the author changes a post; drafts and hidden posts are private', () => {
  const author = {role: 'USER', profile: {id: 'p1'}}, other = {role: 'USER', profile: {id: 'p2'}}, moderator = {role: 'MODERATOR', profile: {id: 'p3'}};
  const draft = {profileId: 'p1', publishedAt: null, hiddenAt: null}, live = {...draft, publishedAt: new Date()}, hidden = {...live, hiddenAt: new Date()};
  for (const action of ['read', 'update', 'publish', 'delete'] as const) for (const post of [draft, live, hidden]) assert.equal(canPost(author, action, post), true);
  for (const viewer of [other, null, undefined, {role: 'USER', profile: null}]) {
    assert.equal(canPost(viewer, 'read', live), true);
    assert.equal(canPost(viewer, 'read', draft), false);
    assert.equal(canPost(viewer, 'read', hidden), false);
    for (const action of ['update', 'publish', 'delete'] as const) for (const post of [draft, live, hidden]) assert.equal(canPost(viewer, action, post), false);
  }
  assert.equal(canPost(moderator, 'read', draft), true);
  assert.equal(canPost(moderator, 'read', hidden), true);
  for (const action of ['update', 'publish', 'delete'] as const) assert.equal(canPost(moderator, action, live), false);
  assert.equal(postAbility({role: 'ADMIN', profile: null}).can('delete', 'Post'), false);
});
test('RSS is well-formed XML with everything escaped', async () => {
  const origin = 'https://dance.example';
  const xml = buildRss({title: 'Anna & <Friends> "blog"', link: origin + '/en/people/anna/posts', self: origin + '/api/feeds/rss/anna?locale=es&x=1',
    description: 'Tom\'s ]]> notes \u0000\u0008 <script>alert(1)</script>', language: 'en', items: [
      {title: 'A <b>bold</b> & "quoted" title', link: origin + '/en/people/anna/posts/a?x=1&y=2', description: 'Body with ]]> and <img src=x onerror=alert(1)> 💃',
        publishedAt: new Date('2030-06-15T10:00:00Z'), author: 'Anna <admin>', image: origin + '/api/media/file/' + KEY + '/800.webp'},
      {title: 'Second', link: origin + '/en/people/anna/posts/b', description: null, publishedAt: new Date('2030-06-14T10:00:00Z')}]});
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.equal(/<script|<b>|<img/.test(xml) || xml.includes(String.fromCharCode(0)) || xml.includes(String.fromCharCode(8)), false);
  assert.ok(xml.includes('A &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; title') && xml.includes('locale=es&amp;x=1') && xml.includes(']]&gt;'));
  const feed = await new Parser().parseString(xml);
  assert.equal(feed.title, 'Anna & <Friends> "blog"');
  assert.equal(feed.items.length, 2);
  assert.equal(feed.items[0].title, 'A <b>bold</b> & "quoted" title');
  assert.equal(feed.items[0].link, origin + '/en/people/anna/posts/a?x=1&y=2');
  assert.equal(feed.items[0].guid, feed.items[0].link);
  assert.equal(new Date(feed.items[0].pubDate!).toISOString(), '2030-06-15T10:00:00.000Z');
  assert.ok(feed.items[0].content?.includes('<img src=x onerror=alert(1)> 💃'));
  for (const item of feed.items) assert.ok(item.link?.startsWith(origin + '/'));
  assert.equal(xmlEscape('a\uD800b'), 'ab');
  // Validators: the same body answers 304 to If-None-Match.
  const first = rssResponse(new Request(origin + '/api/feeds/rss/anna'), xml, new Date('2030-06-15T10:00:00Z'));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'application/rss+xml; charset=utf-8');
  assert.equal(first.headers.get('etag'), etagOf(xml));
  assert.match(first.headers.get('cache-control') || '', /public, max-age=\d+/);
  const again = rssResponse(new Request(origin + '/api/feeds/rss/anna', {headers: {'If-None-Match': 'W/' + etagOf(xml)}}), xml, null);
  assert.equal(again.status, 304);
  assert.equal(rssResponse(new Request(origin, {headers: {'If-None-Match': '"other"'}}), xml, null).status, 200);
});
test('BlogPosting JSON-LD cannot break out of its script element', () => {
  const data = postJsonLd({title: '</script><script>alert(1)</script>', excerpt: 'x' + String.fromCharCode(0x2028) + 'y', publishedAt: new Date('2030-06-15T10:00:00Z'), updatedAt: new Date('2030-06-16T10:00:00Z'),
    profile: {name: 'Anna', handle: 'anna', type: 'DANCER'}, event: {title: 'Camp', slug: 'camp', startsAt: new Date('2030-06-10T10:00:00Z')}},
    {origin: 'https://dance.example', locale: 'es', url: 'https://dance.example/es/people/anna/posts/x', image: 'https://dance.example/i.webp'});
  assert.equal(data['@type'], 'BlogPosting');
  assert.equal(data.author['@type'], 'Person');
  assert.equal(data.dateModified, '2030-06-16T10:00:00.000Z');
  assert.equal(data.about?.url, 'https://dance.example/es/events/camp');
  const json = safeJson(data);
  assert.equal(json.includes('<') || json.includes(String.fromCharCode(0x2028)), false);
  assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(data)));
});
const item = (kind: FeedItem['kind'], id: string, at: string) => ({kind, id, at} as FeedItem);
test('feed merge is reverse-chronological with a stable, lossless cursor', () => {
  const T = (n: number) => new Date(Date.UTC(2030, 0, 1, 0, 0, n)).toISOString();
  const sources = {
    event: [item('event', 'e5', T(9)), item('event', 'e4', T(7)), item('event', 'e3', T(5)), item('event', 'e2', T(5)), item('event', 'e1', T(1))],
    post: [item('post', 'p4', T(8)), item('post', 'p3', T(5)), item('post', 'p2', T(5)), item('post', 'p1', T(2))],
    news: [item('news', 'n3', T(7)), item('news', 'n2', T(5)), item('news', 'n1', T(3))]
  };
  const expected = ['e5', 'p4', 'n3', 'e4', 'p3', 'p2', 'n2', 'e3', 'e2', 'n1', 'p1', 'e1'];
  assert.deepEqual([...sources.event, ...sources.post, ...sources.news].sort(compareFeed).map(i => i.id), expected);
  // Emulates the three database queries: each source filtered by afterCursor, newest first, limit + 1 rows.
  const matches = (where: Record<string, unknown>, row: FeedItem): boolean => {
    const at = Date.parse(row.at);
    if (Array.isArray(where.OR)) return (where.OR as Record<string, unknown>[]).some(part => matches(part, row));
    return Object.entries(where).every(([field, rule]) => {
      if (field === 'id') return row.id < (rule as {lt: string}).lt;
      if (rule instanceof Date) return at === rule.getTime();
      const bound = rule as {lt?: Date; lte?: Date};
      return bound.lt ? at < bound.lt.getTime() : at <= bound.lte!.getTime();
    });
  };
  for (const limit of [1, 2, 3, 5, 12, 20]) {
    const seen: string[] = [];
    let cursor: string | null = null, pages = 0;
    do {
      const decoded = decodeCursor(cursor);
      const lists = (['event', 'post', 'news'] as const).map(kind => sources[kind].filter(row => matches(afterCursor(decoded, kind, 'at'), row)).slice(0, limit + 1));
      const page = mergeFeed(lists, limit);
      assert.ok(page.items.length <= limit);
      seen.push(...page.items.map(i => i.id));
      cursor = page.nextCursor;
      assert.ok(++pages < 50);
    } while (cursor);
    assert.deepEqual(seen, expected, 'limit ' + limit);
  }
  const cursor = encodeCursor(item('post', 'p3', T(5)));
  assert.deepEqual(decodeCursor(cursor), {at: Date.parse(T(5)), kind: 'post', id: 'p3'});
  for (const bad of [null, undefined, '', 'abc', '!!!', 'x'.repeat(300), Buffer.from('1.video.x').toString('base64url'), Buffer.from('NaN.post.x').toString('base64url')])
    assert.equal(decodeCursor(bad), null, String(bad));
  assert.equal(mergeFeed([[], [], []], 20).nextCursor, null);
  assert.deepEqual(afterCursor(null, 'post', 'publishedAt'), {});
});
test('posts in the database: slugs, drafts, hidden content, sitemap and feed', async t => {
  const {db} = await import('@dance/db');
  try {await db.$queryRaw`SELECT 1`;} catch {t.skip('PostgreSQL is not available'); return;}
  const {savePost, createDraft, removePost, publicPosts, postFor} = await import('../src/lib/blog/posts');
  const {sitemapEntries} = await import('../src/lib/blog/sitemap');
  const {feedPage} = await import('../src/lib/feed/query');
  const tag = randomUUID().slice(0, 8), origin = 'https://dance.example';
  const user = (name: string) => db.user.create({data: {id: 'blog-' + name + '-' + tag, name, email: name + '-' + tag + '@example.test', emailVerified: true}});
  const [authorUser, readerUser, hiddenUser] = await Promise.all([user('author'), user('reader'), user('hidden')]);
  const profile = (userId: string, handle: string, hiddenAt: Date | null = null) =>
    db.profile.create({data: {userId, type: 'DANCER', handle: handle + '-' + tag, name: 'Blog ' + handle, hiddenAt}});
  const [author, reader, ghost] = await Promise.all([profile(authorUser.id, 'bauthor'), profile(readerUser.id, 'breader'), profile(hiddenUser.id, 'bghost', new Date())]);
  const body = doc(p(text('Report ' + tag, [link('https://example.com/')])));
  const title = 'Blog test ' + tag;
  try {
    const stored = async (id: string) => db.post.findUniqueOrThrow({where: {id}});
    const make = async (profileId: string, published: boolean) => {
      const {id} = await createDraft(profileId, title);
      await savePost(await stored(id), {content: body, ...(published ? {published: true} : {})});
      return stored(id);
    };
    // Drafts have no address; publishing the same title twice gives two different slugs.
    const draft = await make(author.id, false);
    assert.equal(draft.slug, null);
    assert.equal(draft.publishedAt, null);
    assert.equal(draft.excerpt, 'Report ' + tag);
    const first = await make(author.id, true), second = await make(author.id, true);
    assert.equal(first.slug, 'blog-test-' + tag);
    assert.equal(second.slug, 'blog-test-' + tag + '-2');
    assert.ok(first.publishedAt);
    // The slug survives a rename and an unpublish/publish cycle.
    await savePost(first, {title: 'Renamed ' + tag});
    await savePost(await stored(first.id), {published: false});
    assert.equal((await stored(first.id)).publishedAt, null);
    await savePost(await stored(first.id), {published: true});
    assert.equal((await stored(first.id)).slug, 'blog-test-' + tag);
    // Publishing needs a title and a body; a foreign photo is refused.
    const empty = await createDraft(author.id, '');
    await assert.rejects(savePost(await stored(empty.id), {published: true}), {message: 'TITLE_REQUIRED'});
    await assert.rejects(savePost(await stored(empty.id), {title: 'Has a title', published: true}), {message: 'POST_EMPTY'});
    const foreign = await db.mediaItem.create({data: {postId: second.id, kind: 'upload', storageKey: KEY, uploaderProfileId: author.id}});
    await assert.rejects(savePost(await stored(empty.id), {content: doc(image({mediaId: foreign.id}))}), {message: 'FOREIGN_MEDIA'});
    await assert.rejects(savePost(await stored(empty.id), {content: doc({type: 'script'})}), {message: 'INVALID_CONTENT'});
    await assert.rejects(savePost(await stored(empty.id), {eventId: 'no-such-event'}), {message: 'EVENT_NOT_FOUND'});
    await db.mediaItem.delete({where: {id: foreign.id}});
    // Access: a stranger gets 404 for a draft and 403 for changing a published post.
    const stranger = {role: 'USER', profile: {id: reader.id}};
    await assert.rejects(postFor(stranger, draft.id, 'read'), {code: 'NOT_FOUND'});
    await assert.rejects(postFor(stranger, first.id, 'delete'), {code: 'FORBIDDEN'});
    assert.equal((await postFor({role: 'USER', profile: {id: author.id}}, draft.id, 'delete')).id, draft.id);
    // A post hidden by moderation and a post of a hidden profile are not public.
    const hidden = await make(author.id, true);
    await db.post.update({where: {id: hidden.id}, data: {hiddenAt: new Date()}});
    const ghostPost = await make(ghost.id, true);
    const visible = (await publicPosts({profileId: author.id}, 50)).map(post => post.id);
    assert.deepEqual(visible.sort(), [first.id, second.id].sort());
    assert.equal((await publicPosts({profileId: ghost.id}, 50)).length, 0);
    // Sitemap: published posts and visible profiles only, every language, with alternates.
    const entries = await sitemapEntries(origin), urls = entries.map(entry => entry.url);
    const mine = urls.filter(url => url.includes(tag));
    for (const locale of ['en', 'es', 'ru']) {
      assert.ok(mine.includes(origin + '/' + locale + '/people/' + author.handle + '/posts/' + first.slug), locale);
      assert.ok(mine.includes(origin + '/' + locale + '/people/' + author.handle + '/posts/' + second.slug), locale);
      assert.ok(mine.includes(origin + '/' + locale + '/@' + author.handle), locale);
      assert.ok(urls.includes(origin + '/' + locale + '/events'), locale);
    }
    assert.equal(mine.some(url => url.includes(ghost.handle)), false, 'hidden profile');
    assert.equal(mine.some(url => url.endsWith('/posts/' + hidden.slug)), false, 'hidden post');
    assert.equal(mine.filter(url => url.includes('/posts/')).length, 6, 'two public posts in three languages; the draft has no URL');
    assert.equal(mine.some(url => url.endsWith('/posts/' + ghostPost.slug)), false, 'post of a hidden profile');
    const entry = entries.find(e => e.url === origin + '/es/people/' + author.handle + '/posts/' + first.slug)!;
    assert.equal(entry.alternates.languages.ru, origin + '/ru/people/' + author.handle + '/posts/' + first.slug);
    assert.equal(new Set(urls).size, urls.length);
    // Feed: a follower sees the author's posts, newest first, in pages; nothing hidden, no drafts.
    await db.follow.create({data: {userId: readerUser.id, profileId: author.id}});
    const pageOne = await feedPage({userId: readerUser.id, profileId: reader.id, limit: 1});
    assert.equal(pageOne.mode, 'personal');
    assert.deepEqual(pageOne.items.map(i => i.id), [first.id], 'the republished post is the newest');
    assert.ok(pageOne.nextCursor);
    const pageTwo = await feedPage({userId: readerUser.id, profileId: reader.id, limit: 1, cursor: pageOne.nextCursor});
    assert.deepEqual(pageTwo.items.map(i => i.id), [second.id]);
    assert.equal(pageTwo.nextCursor, null);
    // Without subscriptions the feed falls back to the latest public posts and says so.
    const fallback = await feedPage({userId: authorUser.id, profileId: author.id, limit: 50});
    assert.equal(fallback.mode, 'fallback');
    const fallbackIds = fallback.items.map(i => i.id);
    assert.equal(fallbackIds.includes(hidden.id) || fallbackIds.includes(draft.id) || fallbackIds.includes(ghostPost.id), false);
    assert.deepEqual(fallback.items.map(i => Date.parse(i.at)), fallback.items.map(i => Date.parse(i.at)).sort((a, b) => b - a));
    assert.equal((await feedPage({limit: 5})).mode, 'fallback');
    // Deleting a post removes its media rows.
    const embed = await db.mediaItem.create({data: {postId: second.id, kind: 'instagram', sourceUrl: instagram.attrs.permalink}});
    await removePost(second.id);
    assert.equal(await db.post.count({where: {id: second.id}}), 0);
    assert.equal(await db.mediaItem.count({where: {id: embed.id}}), 0);
  } finally {
    await db.user.deleteMany({where: {id: {in: [authorUser.id, readerUser.id, hiddenUser.id]}}});
    await db.profile.deleteMany({where: {id: {in: [author.id, reader.id, ghost.id]}}});
  }
});
