import {Node, mergeAttributes} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {mediaUrl} from '../../lib/media/url';
import {INSTAGRAM_PERMALINK, safeHref} from '../../lib/blog/nodes';
// Editor schema. It mirrors the server schema in lib/blog/content.ts: whatever is not listed here cannot be typed or pasted,
// and whatever is listed is validated again on save.
const number = (value: string | null) => value && /^\d{1,5}$/.test(value) ? Number(value) : null;
/** An uploaded photo of this post. The node keeps the MediaItem id, its storage key and the required description. */
export const PostImage = Node.create({
  name: 'image', group: 'block', atom: true, selectable: true, draggable: true,
  addAttributes() {
    // Rendered by hand below, so the node survives cut and paste inside the editor.
    const hidden = {default: null, rendered: false};
    return {mediaId: hidden, storageKey: hidden, alt: {default: '', rendered: false}, width: hidden, height: hidden};
  },
  parseHTML() {
    return [{tag: 'figure[data-post-image]', getAttrs: element => {
      const mediaId = element.getAttribute('data-media-id'), storageKey = element.getAttribute('data-key');
      return mediaId && storageKey ? {mediaId, storageKey, alt: element.getAttribute('data-alt') || '',
        width: number(element.getAttribute('data-w')), height: number(element.getAttribute('data-h'))} : false;
    }}];
  },
  renderHTML({node}) {
    const {mediaId, storageKey, alt, width, height} = node.attrs;
    return ['figure', {'data-post-image': '', 'data-media-id': mediaId, 'data-key': storageKey, 'data-alt': alt, 'data-w': width, 'data-h': height, class: 'post-figure'},
      ['img', {src: mediaUrl(String(storageKey)), alt: String(alt || ''), draggable: 'false'}]];
  }
});
/** An Instagram post by link. Only the permalink and the cached oEmbed fields are kept — never Instagram's media. */
export const InstagramBlock = Node.create<{label: string}>({
  name: 'instagram', group: 'block', atom: true, selectable: true, draggable: true,
  addOptions() {return {label: 'Instagram'};},
  addAttributes() {
    const hidden = {default: null, rendered: false};
    return {permalink: hidden, author: hidden, title: hidden, thumbnailUrl: hidden};
  },
  parseHTML() {
    return [{tag: 'div[data-instagram]', getAttrs: element => {
      const permalink = element.getAttribute('data-instagram') || '';
      return INSTAGRAM_PERMALINK.test(permalink) ? {permalink, author: element.getAttribute('data-author'), title: element.getAttribute('data-title'),
        thumbnailUrl: element.getAttribute('data-thumb')} : false;
    }}];
  },
  renderHTML({node}) {
    const {permalink, author, title, thumbnailUrl} = node.attrs;
    return ['div', mergeAttributes({'data-instagram': permalink, 'data-author': author, 'data-title': title, 'data-thumb': thumbnailUrl, class: 'post-ig-node'}),
      ['strong', {}, this.options.label + (author ? ' · ' + author : '')],
      ['span', {}, title ? String(title).slice(0, 140) : ''],
      ['span', {class: 'post-ig-url'}, String(permalink)]];
  }
});
export const blogExtensions = (labels: {instagram: string}) => [
  StarterKit.configure({
    heading: {levels: [2, 3]}, code: false, codeBlock: false, strike: false, underline: false, horizontalRule: false,
    link: {openOnClick: false, autolink: true, linkOnPaste: true, protocols: ['http', 'https', 'mailto'], defaultProtocol: 'https',
      HTMLAttributes: {rel: 'nofollow ugc noopener', target: null}, isAllowedUri: url => safeHref(url) !== null}
  }),
  PostImage, InstagramBlock.configure({label: labels.instagram})
];
