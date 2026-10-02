'use client';
import '../../app/styles/blog.css';
import {useEffect, useId, useRef, useState, type KeyboardEvent} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useLocale, useTranslations} from 'next-intl';
import {EditorContent, useEditor, useEditorState} from '@tiptap/react';
import {cleanContent, safeHref, type ImageAttrs} from '../../lib/blog/nodes';
import {postPath} from '../../lib/blog/links';
import {mediaUrl} from '../../lib/media/url';
import {ImageUpload, type UploadedImage} from '../media/image-upload';
import {blogExtensions} from './extensions';
export type EditorPost = {id: string; title: string; content: unknown; eventId: string | null; published: boolean; slug: string | null; handle: string;
  /** The version the editor starts from (ISO time of the last save); sent back with every save. */
  updatedAt: string;
  /** Name of the school the post is published by; null for the author's own post. */
  publisher: string | null};
export type EventOption = {id: string; label: string};
type Panel = 'link' | 'image' | 'instagram' | null;
type Auto = '' | 'saving' | 'saved' | 'error' | 'stale';
type Photo = {mediaId: string; storageKey: string; alt: string};
type PhotoAction = 'up' | 'down' | 'remove';
// A draft is saved this long after the last change, and at the latest this long after the first unsaved one.
const AUTOSAVE_DELAY = 2500, AUTOSAVE_MAX_WAIT = 12_000, AUTOSAVE_RETRY = 20_000;
// Browsers refuse keepalive requests with more than 64 KiB in flight.
const KEEPALIVE_LIMIT = 60_000;
async function send(url: string, method: string, body?: unknown, options: {keepalive?: boolean; signal?: AbortSignal} = {}) {
  const response = await fetch(url, {method, headers: {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body), ...options});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'GENERIC');
  return data;
}
const code = (failure: unknown) => failure instanceof Error ? failure.message : 'GENERIC';
/** One photo of the body: its description, and buttons to move it among the photos or take it out. */
function PhotoRow({photo, index, total, onAlt, onMove, onRemove}: {photo: Photo; index: number; total: number;
  onAlt: (alt: string) => void; onMove: (by: number) => void; onRemove: () => void}) {
  const t = useTranslations('Blog'), uid = useId(), number = index + 1;
  const [draft, setDraft] = useState(photo.alt), [base, setBase] = useState(photo.alt), [missing, setMissing] = useState(false);
  // The description changed elsewhere (undo, a swap with another photo): the field follows the body.
  if (base !== photo.alt) {setBase(photo.alt); setDraft(photo.alt); setMissing(false);}
  function commit() {
    const alt = draft.trim();
    // A photo never stays without a description: the field keeps the focus of attention until it has one.
    if (!alt) return setMissing(true);
    setMissing(false);
    if (alt !== photo.alt) onAlt(alt);
  }
  return <li className="post-row" data-photo={index}>
    <div>
      <img src={mediaUrl(photo.storageKey)} alt="" width={96} height={72} loading="lazy" decoding="async" style={{objectFit: 'cover', borderRadius: 8}}/>
      <label htmlFor={uid}>{t('photoAltLabel', {number})}
        <input id={uid} type="text" value={draft} maxLength={300} required aria-invalid={missing || undefined} aria-describedby={missing ? uid + 'error' : undefined}
          onChange={event => setDraft(event.target.value)} onBlur={commit}
          onKeyDown={event => {if (event.key === 'Enter') {event.preventDefault(); commit();}}}/>
      </label>
      {missing && <p id={uid + 'error'} role="alert" className="form-error">{t('error_ALT_REQUIRED')}</p>}
    </div>
    <div className="post-panel-actions">
      <button type="button" className="button secondary" data-act="up" disabled={index === 0} aria-label={t('photoUpLabel', {number})} onClick={() => onMove(-1)}>{t('photoUp')}</button>
      <button type="button" className="button secondary" data-act="down" disabled={index === total - 1} aria-label={t('photoDownLabel', {number})} onClick={() => onMove(1)}>{t('photoDown')}</button>
      <button type="button" className="button secondary post-danger" data-act="remove" aria-label={t('photoRemoveLabel', {number})} onClick={onRemove}>{t('photoRemove')}</button>
    </div>
  </li>;
}
export function PostEditor({post, events}: {post: EditorPost; events: EventOption[]}) {
  const t = useTranslations('Blog'), locale = useLocale(), router = useRouter(), uid = useId();
  const [title, setTitle] = useState(post.title), [eventId, setEventId] = useState(post.eventId || '');
  const [published, setPublished] = useState(post.published), [slug, setSlug] = useState(post.slug);
  const [panel, setPanel] = useState<Panel>(null), [tool, setTool] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState(''), [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false), [confirming, setConfirming] = useState(false), [auto, setAuto] = useState<Auto>('');
  const [linkUrl, setLinkUrl] = useState(''), [panelError, setPanelError] = useState('');
  const [pending, setPending] = useState<ImageAttrs | null>(null);
  const [igUrl, setIgUrl] = useState(''), [igBusy, setIgBusy] = useState(false);
  const toolbar = useRef<HTMLDivElement>(null), panelRef = useRef<HTMLDivElement>(null), photoList = useRef<HTMLUListElement>(null);
  // Autosave bookkeeping lives in refs: timers and page-lifecycle listeners must see the current values, not a render's copy.
  const version = useRef(post.updatedAt), revision = useRef(0), savedRevision = useRef(0), firstChange = useRef(0);
  const timer = useRef<number | undefined>(undefined), stopped = useRef(false);
  const inflight = useRef<{done: Promise<void>; abort: AbortController} | null>(null);
  const live = useRef({title, eventId, published, busy, warn: false});
  const run = useRef<(closing?: boolean) => Promise<void>>(async () => {}), changed = useRef(() => {});
  const focusPhoto = useRef<{index: number; act: PhotoAction} | null>(null);
  const editor = useEditor({
    extensions: blogExtensions({instagram: t('instagramBlock')}), content: post.content as object,
    // The page is rendered on the server first; the editor is created in the browser only.
    immediatelyRender: false,
    editorProps: {attributes: {class: 'post-editor-area post-body', role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('bodyLabel')}},
    onUpdate: () => changed.current()
  });
  const active = useEditorState({editor, selector: ({editor: current}) => current ? {
    h2: current.isActive('heading', {level: 2}), h3: current.isActive('heading', {level: 3}), bold: current.isActive('bold'), italic: current.isActive('italic'),
    bullet: current.isActive('bulletList'), ordered: current.isActive('orderedList'), quote: current.isActive('blockquote'), link: current.isActive('link'),
    undo: current.can().undo(), redo: current.can().redo()} : null});
  // The photos of the body, in reading order — the list under the editor is built from this.
  const photos = useEditorState({editor, selector: ({editor: current}) => {
    const found: Photo[] = [];
    current?.state.doc.descendants(node => {
      if (node.type.name === 'image') found.push({mediaId: String(node.attrs.mediaId), storageKey: String(node.attrs.storageKey), alt: String(node.attrs.alt || '')});
    });
    return found;
  }}) || [];
  const body = () => ({title: live.current.title.trim(), content: cleanContent(editor!.getJSON()), eventId: live.current.eventId || null});
  function schedule(delay = AUTOSAVE_DELAY, exact = false) {
    window.clearTimeout(timer.current);
    // Only drafts are saved without being asked: a published post changes for its readers on Save alone.
    if (live.current.published || stopped.current) return;
    const now = Date.now();
    if (!firstChange.current) firstChange.current = now;
    timer.current = window.setTimeout(() => void run.current(), exact ? delay : Math.max(0, Math.min(delay, firstChange.current + AUTOSAVE_MAX_WAIT - now)));
  }
  function touch() {
    revision.current++;
    setDirty(true); setStatus(''); setAuto(current => current === 'saved' ? '' : current);
    schedule();
  }
  /** Saves the draft in the background. `closing`: the page is going away, so the request must outlive it. */
  async function autosave(closing = false) {
    window.clearTimeout(timer.current);
    const state = live.current, rev = revision.current;
    if (!editor || state.published || state.busy || stopped.current || rev === savedRevision.current) return;
    if (inflight.current) {
      // A save is under way and will re-arm the timer itself. A closing page cannot wait: the newer text replaces it.
      if (!closing) return;
      inflight.current.abort.abort();
    }
    let payload;
    try {payload = {...body(), updatedAt: version.current, autosave: true};} catch {return;}
    const abort = new AbortController();
    const keepalive = closing && new TextEncoder().encode(JSON.stringify(payload)).length < KEEPALIVE_LIMIT;
    if (!closing) setAuto('saving');
    const done = send('/api/posts/' + post.id, 'PATCH', payload, {keepalive, signal: abort.signal}).then(saved => {
      version.current = saved.updatedAt; savedRevision.current = rev; firstChange.current = 0;
      if (revision.current === rev) {setDirty(false); setAuto('saved');} else {setAuto(''); schedule();}
    }, failure => {
      if (abort.signal.aborted) return;
      const reason = code(failure);
      // Somebody else saved or published the post meanwhile: autosave stops and the author decides with the Save button.
      if (reason === 'STALE_POST' || reason === 'AUTOSAVE_PUBLISHED' || reason === 'NOT_FOUND') {stopped.current = true; setAuto('stale');}
      else {setAuto('error'); schedule(AUTOSAVE_RETRY, true);}
    }).finally(() => {if (inflight.current?.abort === abort) inflight.current = null;});
    inflight.current = {done, abort};
    await done;
  }
  // Refs are refreshed after every render, so callbacks registered once always run the current code.
  useEffect(() => {
    live.current = {title, eventId, published, busy, warn: dirty && (published || auto === 'error' || auto === 'stale')};
    run.current = autosave; changed.current = touch;
  });
  useEffect(() => {
    const flush = () => void run.current(true);
    const hidden = () => {if (document.visibilityState === 'hidden') flush();};
    // Leaving is confirmed only when the changes would be lost: a draft is saved on the way out instead.
    const warn = (event: BeforeUnloadEvent) => {if (live.current.warn) event.preventDefault();};
    window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', hidden); window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('beforeunload', warn);
      // Navigation inside the site unmounts the editor without any page event.
      window.clearTimeout(timer.current); flush();
    };
  }, []);
  // A panel that has just opened takes the focus, so keyboard and screen-reader users land in it.
  useEffect(() => {if (panel) panelRef.current?.querySelector<HTMLElement>('input')?.focus();}, [panel]);
  // After a photo moved or left, the focus follows it (or goes to its neighbour) instead of falling back to the page.
  useEffect(() => {
    const want = focusPhoto.current;
    if (!want) return;
    focusPhoto.current = null;
    const row = photoList.current?.querySelector('[data-photo="' + want.index + '"]');
    const button = row?.querySelector<HTMLButtonElement>('[data-act="' + want.act + '"]:not(:disabled)') ?? row?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    if (button) button.focus(); else editor?.commands.focus();
  });
  function open(next: Panel) {
    setPanelError(''); setPending(null);
    if (next === 'link') setLinkUrl(editor?.getAttributes('link').href || '');
    setPanel(current => current === next ? null : next);
  }
  function close() {setPanel(null); setPanelError(''); setPending(null); editor?.commands.focus();}
  function applyLink() {
    if (!editor) return;
    const raw = linkUrl.trim(), href = safeHref(raw) ?? (/^[a-z][a-z0-9+.-]*:/i.test(raw) ? null : safeHref('https://' + raw));
    if (!href) return setPanelError('LINK_INVALID');
    if (editor.state.selection.empty && !editor.isActive('link'))
      editor.chain().focus().insertContent({type: 'text', text: raw, marks: [{type: 'link', attrs: {href}}]}).run();
    else editor.chain().focus().extendMarkRange('link').setLink({href}).run();
    setPanel(null);
  }
  function removeLink() {editor?.chain().focus().extendMarkRange('link').unsetLink().run(); setPanel(null);}
  function insertImage(image: ImageAttrs) {
    const alt = image.alt.trim();
    if (!alt) return setPanelError('ALT_REQUIRED');
    editor?.chain().focus().insertContent([{type: 'image', attrs: {...image, alt}}, {type: 'paragraph'}]).run();
    setPending(null); setPanel(null); setPanelError('');
  }
  function uploaded(image: UploadedImage) {
    if (!image.id) return;
    const next = {mediaId: image.id, storageKey: image.key, alt: image.item?.alt?.trim() || '', width: image.item?.width ?? null, height: image.item?.height ?? null};
    // A photo without a description is not inserted: the author is asked for one first.
    if (next.alt) insertImage(next); else {setPending(next); setPanelError('');}
  }
  async function insertPending() {
    if (!pending) return;
    if (!pending.alt.trim()) return setPanelError('ALT_REQUIRED');
    // The same description is kept on the media item, for galleries and moderation. The post itself does not depend on it.
    void send('/api/media/items', 'PATCH', {id: pending.mediaId, alt: pending.alt.trim()}).catch(() => {});
    insertImage(pending);
  }
  // Positions of the image nodes, read from the document at the moment of the action.
  function photoNodes() {
    const found: {pos: number; size: number; attrs: Record<string, unknown>}[] = [];
    editor?.state.doc.descendants((node, pos) => {if (node.type.name === 'image') found.push({pos, size: node.nodeSize, attrs: node.attrs});});
    return found;
  }
  function setPhotoAlt(index: number, alt: string) {
    const nodes = photoNodes(), target = nodes[index];
    if (!editor || !target) return;
    // The same upload may appear twice (copy and paste): every copy gets the new description.
    editor.chain().command(({tr}) => {
      for (const node of nodes) if (node.attrs.mediaId === target.attrs.mediaId) tr.setNodeMarkup(node.pos, undefined, {...node.attrs, alt});
      return true;
    }).run();
    // The media item carries the same text for galleries and cards; saving the post repeats this on the server.
    void send('/api/media/items', 'PATCH', {id: String(target.attrs.mediaId), alt}).catch(() => {});
    setNotice(t('photoAltSaved'));
  }
  function movePhoto(index: number, by: number) {
    const nodes = photoNodes(), from = nodes[index], to = nodes[index + by];
    if (!editor || !from || !to) return;
    // Two photos swap places; the text around them stays where it is, so no position shifts.
    editor.chain().command(({tr}) => {tr.setNodeMarkup(from.pos, undefined, to.attrs).setNodeMarkup(to.pos, undefined, from.attrs); return true;}).run();
    focusPhoto.current = {index: index + by, act: by < 0 ? 'up' : 'down'};
    setNotice(t('photoMoved', {position: index + by + 1, total: nodes.length}));
  }
  function removePhoto(index: number) {
    const nodes = photoNodes(), target = nodes[index];
    if (!editor || !target) return;
    editor.chain().command(({tr}) => {tr.delete(target.pos, target.pos + target.size); return true;}).run();
    focusPhoto.current = {index: Math.min(index, nodes.length - 2), act: 'remove'};
    setNotice(t('photoRemoved'));
  }
  async function addInstagram() {
    if (!editor || igBusy) return;
    setPanelError(''); setIgBusy(true);
    try {
      const embed = await send('/api/embed', 'POST', {url: igUrl.trim()});
      editor.chain().focus().insertContent([{type: 'instagram', attrs: {permalink: embed.permalink, author: embed.author || null,
        title: embed.title || null, thumbnailUrl: embed.thumbnailUrl || null}}, {type: 'paragraph'}]).run();
      setIgUrl(''); setPanel(null);
      if (embed.status === 'degraded') setStatus('embedDegraded');
    } catch (failure) {setPanelError(code(failure));} finally {setIgBusy(false);}
  }
  /** The explicit save. `force` overwrites a version saved elsewhere, after the author has been told about it. */
  async function save(publish?: boolean, force = false) {
    if (!editor || busy) return;
    window.clearTimeout(timer.current);
    setBusy(true); live.current.busy = true; setError(''); setStatus(''); setNotice('');
    try {
      // An autosave under way finishes first, so this request carries the version it produces.
      await inflight.current?.done;
      const rev = revision.current;
      const saved = await send('/api/posts/' + post.id, 'PATCH', {...body(), ...(force ? {} : {updatedAt: version.current}),
        ...(publish === undefined ? {} : {published: publish})});
      version.current = saved.updatedAt; savedRevision.current = rev; firstChange.current = 0; stopped.current = false;
      live.current.published = !!saved.publishedAt;
      setPublished(!!saved.publishedAt); setSlug(saved.slug); setAuto('');
      if (revision.current === rev) setDirty(false); else schedule();
      setStatus(publish === true ? 'statusPublished' : publish === false ? 'statusUnpublished' : 'statusSaved');
      router.refresh();
    } catch (failure) {setError(code(failure));} finally {setBusy(false); live.current.busy = false;}
  }
  async function remove() {
    setBusy(true); setError('');
    try {
      await send('/api/posts/' + post.id, 'DELETE');
      // Nothing is left to save.
      stopped.current = true; savedRevision.current = revision.current;
      setDirty(false);
      router.push('/' + locale + '/posts'); router.refresh();
    } catch (failure) {setError(code(failure)); setBusy(false);}
  }
  const message = (value: string) => t.has('error_' + value) ? t('error_' + value) : t('error_GENERIC');
  const chain = () => editor!.chain().focus();
  const tools: {key: string; label: string; glyph: string; pressed?: boolean; expanded?: boolean; disabled?: boolean; run: () => void}[] = [
    {key: 'h2', label: t('toolHeading2'), glyph: 'H2', pressed: !!active?.h2, run: () => chain().toggleHeading({level: 2}).run()},
    {key: 'h3', label: t('toolHeading3'), glyph: 'H3', pressed: !!active?.h3, run: () => chain().toggleHeading({level: 3}).run()},
    {key: 'bold', label: t('toolBold'), glyph: 'B', pressed: !!active?.bold, run: () => chain().toggleBold().run()},
    {key: 'italic', label: t('toolItalic'), glyph: 'I', pressed: !!active?.italic, run: () => chain().toggleItalic().run()},
    {key: 'bullet', label: t('toolBulletList'), glyph: '•', pressed: !!active?.bullet, run: () => chain().toggleBulletList().run()},
    {key: 'ordered', label: t('toolOrderedList'), glyph: '1.', pressed: !!active?.ordered, run: () => chain().toggleOrderedList().run()},
    {key: 'quote', label: t('toolQuote'), glyph: '”', pressed: !!active?.quote, run: () => chain().toggleBlockquote().run()},
    {key: 'link', label: t('toolLink'), glyph: '🔗', pressed: !!active?.link, expanded: panel === 'link', run: () => open('link')},
    {key: 'image', label: t('toolImage'), glyph: '🖼', expanded: panel === 'image', run: () => open('image')},
    {key: 'instagram', label: t('toolInstagram'), glyph: 'IG', expanded: panel === 'instagram', run: () => open('instagram')},
    {key: 'undo', label: t('toolUndo'), glyph: '↶', disabled: !active?.undo, run: () => chain().undo().run()},
    {key: 'redo', label: t('toolRedo'), glyph: '↷', disabled: !active?.redo, run: () => chain().redo().run()}
  ];
  // Toolbar pattern: one tab stop, arrow keys move between the buttons.
  function onToolbarKey(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = {ArrowRight: 1, ArrowLeft: -1};
    if (!(event.key in moves) && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const buttons = [...(toolbar.current?.querySelectorAll<HTMLButtonElement>('button') || [])];
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : tool;
    // Disabled buttons are skipped.
    for (let step = 0; step < buttons.length; step++) {
      if (event.key in moves) next = (next + moves[event.key] + buttons.length) % buttons.length;
      if (!buttons[next]?.disabled) break;
      if (event.key === 'Home') next++; else if (event.key === 'End') next--;
    }
    if (buttons[next] && !buttons[next].disabled) {setTool(next); buttons[next].focus();}
  }
  const current = tools[tool]?.disabled ? tools.findIndex(item => !item.disabled) : tool;
  return <form className="post-editor" onSubmit={event => {event.preventDefault(); void save();}} aria-busy={busy}
    // Leaving the form (another window, the site menu) saves the draft at once.
    onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget)) void autosave();}}>
    {post.publisher && <p className="post-state">{t('publisherNote', {name: post.publisher})}</p>}
    <label htmlFor={uid + 'title'}>{t('titleLabel')}
      <input id={uid + 'title'} type="text" value={title} maxLength={200} required aria-describedby={uid + 'titlehint'}
        onChange={event => {setTitle(event.target.value); live.current.title = event.target.value; touch();}}/>
      <small id={uid + 'titlehint'}>{t('titleHint')}</small>
    </label>
    <div className="post-editor-box">
      <div ref={toolbar} className="post-toolbar" role="toolbar" aria-label={t('toolbarLabel')} aria-controls={uid + 'body'} onKeyDown={onToolbarKey}>
        {tools.map((item, index) => <button key={item.key} type="button" className={'post-tool' + (item.pressed ? ' is-active' : '')}
          aria-label={item.label} title={item.label} aria-pressed={item.pressed === undefined ? undefined : item.pressed}
          aria-expanded={item.expanded === undefined ? undefined : item.expanded} aria-controls={item.expanded === undefined ? undefined : uid + 'panel'}
          disabled={!editor || item.disabled} tabIndex={index === current ? 0 : -1} onFocus={() => setTool(index)}
          onClick={item.run}><span aria-hidden="true">{item.glyph}</span></button>)}
      </div>
      <div id={uid + 'panel'} ref={panelRef}>
        {panel && <div className="post-panel" role="group" aria-label={t(panel === 'link' ? 'toolLink' : panel === 'image' ? 'toolImage' : 'toolInstagram')}
          onKeyDown={event => {
            if (event.key === 'Escape') {event.stopPropagation(); close();}
            // Enter inside a panel never submits the whole post.
            const target = event.target as HTMLInputElement;
            if (event.key === 'Enter' && target.tagName === 'INPUT' && target.type !== 'file') event.preventDefault();
          }}>
          {panel === 'link' && <>
            <label htmlFor={uid + 'link'}>{t('linkLabel')}
              <input id={uid + 'link'} type="url" inputMode="url" value={linkUrl} maxLength={2000} placeholder="https://" aria-describedby={uid + 'linkhint'}
                onChange={event => setLinkUrl(event.target.value)} onKeyDown={event => {if (event.key === 'Enter') {event.preventDefault(); applyLink();}}}/>
              <small id={uid + 'linkhint'}>{t('linkHint')}</small>
            </label>
            <div className="post-panel-actions">
              <button type="button" className="button" onClick={applyLink}>{t('linkApply')}</button>
              {active?.link && <button type="button" className="button secondary" onClick={removeLink}>{t('linkRemove')}</button>}
              <button type="button" className="button secondary" onClick={close}>{t('cancel')}</button>
            </div>
          </>}
          {panel === 'image' && <>
            {pending ? <>
              <label htmlFor={uid + 'alt'}>{t('altLabel')}
                <input id={uid + 'alt'} type="text" value={pending.alt} maxLength={300} required aria-describedby={uid + 'althint'}
                  onChange={event => setPending({...pending, alt: event.target.value})}
                  onKeyDown={event => {if (event.key === 'Enter') {event.preventDefault(); void insertPending();}}}/>
                <small id={uid + 'althint'}>{t('altHint')}</small>
              </label>
              <div className="post-panel-actions"><button type="button" className="button" onClick={() => void insertPending()}>{t('imageInsert')}</button></div>
            </> : <>
              <p className="field-note">{t('imageHint')}</p>
              <ImageUpload target="post" targetId={post.id} onUploaded={uploaded}/>
              <div className="post-panel-actions"><button type="button" className="button secondary" onClick={close}>{t('cancel')}</button></div>
            </>}
          </>}
          {panel === 'instagram' && <>
            <label htmlFor={uid + 'ig'}>{t('instagramLabel')}
              <input id={uid + 'ig'} type="url" inputMode="url" value={igUrl} maxLength={500} placeholder="https://www.instagram.com/p/…" aria-describedby={uid + 'ighint'}
                onChange={event => setIgUrl(event.target.value)} onKeyDown={event => {if (event.key === 'Enter') {event.preventDefault(); void addInstagram();}}}/>
              <small id={uid + 'ighint'}>{t('instagramHint')}</small>
            </label>
            <div className="post-panel-actions">
              <button type="button" className="button" disabled={igBusy || !igUrl.trim()} onClick={() => void addInstagram()}>{t(igBusy ? 'working' : 'instagramInsert')}</button>
              <button type="button" className="button secondary" onClick={close}>{t('cancel')}</button>
            </div>
          </>}
          {panelError && <p role="alert" className="form-error">{message(panelError)}</p>}
        </div>}
      </div>
      <div id={uid + 'body'}>{editor ? <EditorContent editor={editor}/> : <p className="post-editor-area post-editor-loading" aria-hidden="true">{t('editorLoading')}</p>}</div>
    </div>
    {photos.length > 0 && <div className="post-panel" role="group" aria-labelledby={uid + 'photos'}>
      <strong id={uid + 'photos'}>{t('photosTitle')}</strong>
      <p className="field-note">{t('photosHint')}</p>
      <ul ref={photoList} className="post-rows">
        {photos.map((photo, index) => <PhotoRow key={photo.mediaId + ':' + index} photo={photo} index={index} total={photos.length}
          onAlt={alt => setPhotoAlt(index, alt)} onMove={by => movePhoto(index, by)} onRemove={() => removePhoto(index)}/>)}
      </ul>
    </div>}
    <label htmlFor={uid + 'event'}>{t('eventLabel')}
      <select id={uid + 'event'} value={eventId} aria-describedby={uid + 'eventhint'}
        onChange={event => {setEventId(event.target.value); live.current.eventId = event.target.value; touch();}}>
        <option value="">{t('eventNone')}</option>
        {events.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <small id={uid + 'eventhint'}>{t('eventHint')}</small>
    </label>
    <p className="post-state">{t(published ? 'statePublished' : 'stateDraft')}{dirty ? ' · ' + t(auto === 'saving' ? 'autosaveSaving' : 'unsaved') : ''}
      {published && <small> {t('autosaveOff')}</small>}</p>
    {/* Autosave reports here; the wording changes only when a save ends, so a screen reader is not interrupted while typing. */}
    <p className="post-status" role="status" aria-live="polite">{auto === 'saved' ? t('autosaveSaved') : auto === 'error' ? t('autosaveError') : auto === 'stale' ? t('autosaveStale') : ''}</p>
    <p className="post-status" role="status" aria-live="polite">{notice || (status ? t(status) : '')}</p>
    {error && <p role="alert" className="form-error">{message(error)}</p>}
    <div className="post-actions">
      <button type="submit" className="button" disabled={busy || !editor}>{t(busy ? 'working' : published ? 'saveChanges' : 'saveDraft')}</button>
      {error === 'STALE_POST' && <button type="button" className="button secondary" disabled={busy || !editor} onClick={() => void save(undefined, true)}>{t('saveAnyway')}</button>}
      {published ? <button type="button" className="button secondary" disabled={busy || !editor} onClick={() => void save(false)}>{t('unpublish')}</button> :
        <button type="button" className="button secondary" disabled={busy || !editor} onClick={() => void save(true)}>{t('publish')}</button>}
      {published && slug && <Link className="button secondary" href={postPath(locale, post.handle, slug)}>{t('viewPost')}</Link>}
      {confirming ? <span className="post-confirm" role="group" aria-label={t('deleteConfirm')}>
        <span>{t('deleteConfirm')}</span>
        <button type="button" className="button post-danger" disabled={busy} onClick={() => void remove()}>{t('deleteYes')}</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirming(false)}>{t('cancel')}</button>
      </span> : <button type="button" className="button secondary post-danger" disabled={busy} onClick={() => setConfirming(true)}>{t('delete')}</button>}
    </div>
  </form>;
}
