'use client';
import '../../app/styles/blog.css';
import {useEffect, useId, useRef, useState, type KeyboardEvent} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useLocale, useTranslations} from 'next-intl';
import {EditorContent, useEditor, useEditorState} from '@tiptap/react';
import {cleanContent, safeHref, type ImageAttrs} from '../../lib/blog/nodes';
import {postPath} from '../../lib/blog/links';
import {ImageUpload, type UploadedImage} from '../media/image-upload';
import {blogExtensions} from './extensions';
export type EditorPost = {id: string; title: string; content: unknown; eventId: string | null; published: boolean; slug: string | null; handle: string};
export type EventOption = {id: string; label: string};
type Panel = 'link' | 'image' | 'instagram' | null;
async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {method, headers: {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'GENERIC');
  return data;
}
const code = (failure: unknown) => failure instanceof Error ? failure.message : 'GENERIC';
export function PostEditor({post, events}: {post: EditorPost; events: EventOption[]}) {
  const t = useTranslations('Blog'), locale = useLocale(), router = useRouter(), uid = useId();
  const [title, setTitle] = useState(post.title), [eventId, setEventId] = useState(post.eventId || '');
  const [published, setPublished] = useState(post.published), [slug, setSlug] = useState(post.slug);
  const [panel, setPanel] = useState<Panel>(null), [tool, setTool] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [dirty, setDirty] = useState(false), [confirming, setConfirming] = useState(false);
  const [linkUrl, setLinkUrl] = useState(''), [panelError, setPanelError] = useState('');
  const [pending, setPending] = useState<ImageAttrs | null>(null);
  const [igUrl, setIgUrl] = useState(''), [igBusy, setIgBusy] = useState(false);
  const toolbar = useRef<HTMLDivElement>(null), panelRef = useRef<HTMLDivElement>(null);
  const editor = useEditor({
    extensions: blogExtensions({instagram: t('instagramBlock')}), content: post.content as object,
    // The page is rendered on the server first; the editor is created in the browser only.
    immediatelyRender: false,
    editorProps: {attributes: {class: 'post-editor-area post-body', role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('bodyLabel')}},
    onUpdate: () => {setDirty(true); setStatus('');}
  });
  const active = useEditorState({editor, selector: ({editor: current}) => current ? {
    h2: current.isActive('heading', {level: 2}), h3: current.isActive('heading', {level: 3}), bold: current.isActive('bold'), italic: current.isActive('italic'),
    bullet: current.isActive('bulletList'), ordered: current.isActive('orderedList'), quote: current.isActive('blockquote'), link: current.isActive('link'),
    undo: current.can().undo(), redo: current.can().redo()} : null});
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {event.preventDefault();};
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  // A panel that has just opened takes the focus, so keyboard and screen-reader users land in it.
  useEffect(() => {if (panel) panelRef.current?.querySelector<HTMLElement>('input')?.focus();}, [panel]);
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
  async function save(publish?: boolean) {
    if (!editor || busy) return;
    setBusy(true); setError(''); setStatus('');
    try {
      const saved = await send('/api/posts/' + post.id, 'PATCH', {title: title.trim(), content: cleanContent(editor.getJSON()), eventId: eventId || null,
        ...(publish === undefined ? {} : {published: publish})});
      setPublished(!!saved.publishedAt); setSlug(saved.slug); setDirty(false);
      setStatus(publish === true ? 'statusPublished' : publish === false ? 'statusUnpublished' : 'statusSaved');
      router.refresh();
    } catch (failure) {setError(code(failure));} finally {setBusy(false);}
  }
  async function remove() {
    setBusy(true); setError('');
    try {
      await send('/api/posts/' + post.id, 'DELETE');
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
  return <form className="post-editor" onSubmit={event => {event.preventDefault(); void save();}} aria-busy={busy}>
    <label htmlFor={uid + 'title'}>{t('titleLabel')}
      <input id={uid + 'title'} type="text" value={title} maxLength={200} required aria-describedby={uid + 'titlehint'}
        onChange={event => {setTitle(event.target.value); setDirty(true); setStatus('');}}/>
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
    <label htmlFor={uid + 'event'}>{t('eventLabel')}
      <select id={uid + 'event'} value={eventId} aria-describedby={uid + 'eventhint'} onChange={event => {setEventId(event.target.value); setDirty(true); setStatus('');}}>
        <option value="">{t('eventNone')}</option>
        {events.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <small id={uid + 'eventhint'}>{t('eventHint')}</small>
    </label>
    <p className="post-state">{t(published ? 'statePublished' : 'stateDraft')}{dirty ? ' · ' + t('unsaved') : ''}</p>
    <p className="post-status" role="status" aria-live="polite">{status ? t(status) : ''}</p>
    {error && <p role="alert" className="form-error">{message(error)}</p>}
    <div className="post-actions">
      <button type="submit" className="button" disabled={busy || !editor}>{t(busy ? 'working' : published ? 'saveChanges' : 'saveDraft')}</button>
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
