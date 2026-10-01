'use client';
import {useState} from 'react';
import {useCustom} from '@refinedev/core';
import Link from 'next/link';
import {api, errorCode} from '../lib/data-provider';
import {useDate} from './cells';
import {useT} from './i18n';
import {targetResources, usePanel} from './panel';
import {ReasonDialog, type Ask} from './reason-dialog';
type Person = {id: string; name: string; email: string};
type Group = {
  key: string; targetType: string; targetId: string; total: number; oldest: string; overdue: boolean;
  reports: {id: string; reason: string; comment: string | null; createdAt: string; reporter: Person | null}[];
  author: (Person & {role: string; bannedAt: string | null}) | null;
  target: {title: string; text: string | null; hiddenAt: string | null; path: string | null; imageUrl: string | null} | null;
};
type Queue = {data: Group[]; total: number};
const reasons = ['SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'FAKE', 'COPYRIGHT', 'OTHER'];
const pageSize = 20;
function Card({group, onDone}: {group: Group; onDone: () => void}) {
  const {t, locale} = useT(), {user, webUrl} = usePanel(), date = useDate();
  const [reason, setReason] = useState(group.reports[0].reason), [comment, setComment] = useState(''), [ask, setAsk] = useState<Ask | null>(null);
  const {target, author} = group, headingId = 'q-' + group.key.replace(/[^a-zA-Z0-9]/g, '-');
  // Moderators cannot ban staff, nobody bans themselves, and an already banned author needs no second ban.
  const mayBan = !!author && !author.bannedAt && author.id !== user.id && (author.role === 'USER' || ['OWNER','ADMIN'].includes(user.role));
  // One click on a decision plus one on the confirmation: together with opening the queue that is three clicks.
  const decide = (action: 'HIDE' | 'DELETE' | 'NONE' | 'DISMISS', banAuthor: boolean, label: string) => setAsk({
    title: label, confirm: t('confirm'), danger: action === 'DELETE' || banAuthor, reason: 'none',
    text: t('decisionText', {count: group.reports.length, reason: t('reason.' + (action === 'DISMISS' ? 'NO_VIOLATION' : reason))}),
    run: async () => {
      await api('/api/moderation/resolve', {method: 'POST', body: {targetType: group.targetType, targetId: group.targetId, action, banAuthor,
        reason: action === 'DISMISS' ? 'NO_VIOLATION' : reason, comment: comment.trim() || undefined}});
      onDone();
    }});
  return <li><article className={group.overdue ? 'card overdue' : 'card'} aria-labelledby={headingId}>
    <header>
      <h2 id={headingId}><span className="badge">{t('target.' + group.targetType)}</span> {target ? target.title || group.targetId : t('targetGone')}</h2>
      <p className="muted">{t('reportCount', {open: group.reports.length, total: group.total})} · {t('waitingSince', {date: date(group.oldest)})}
        {group.overdue && <> · <strong className="badge danger">{t('overdue')}</strong></>}</p>
    </header>
    {target && <div className="preview-box">
      {target.hiddenAt && <p><span className="badge">{t('alreadyHidden')}</span></p>}
      {target.imageUrl && <a href={target.imageUrl} target="_blank" rel="noreferrer"><img className="preview" src={target.imageUrl} alt={t('mediaPreview')} loading="lazy"/></a>}
      {target.text ? <p className="pre">{target.text}</p> : <p className="muted">{t('noText')}</p>}
      <p className="links"><Link href={'/r/' + targetResources[group.targetType] + '/' + encodeURIComponent(group.targetId)}>{t('openRecord')}</Link>
        {target.path && <a href={webUrl + '/' + locale + target.path} target="_blank" rel="noreferrer">{t('openOnSite')}</a>}</p>
    </div>}
    <p>{t('author')}: {author ? <><Link href={'/r/users/' + encodeURIComponent(author.id)}>{author.name}</Link> <span className="muted">{author.email}</span>
      {author.role !== 'USER' && <> <span className="badge">{author.role}</span></>}{author.bannedAt && <> <span className="badge danger">{t('banned')}</span></>}</>
      : <span className="muted">{t('noAuthor')}</span>}</p>
    <ul className="reports">{group.reports.map(report => <li key={report.id}>
      <strong>{t('reason.' + report.reason)}</strong>{report.comment ? ' — ' + report.comment : ''}
      <span className="muted"> · {report.reporter ? report.reporter.name : t('deletedUser')} · {date(report.createdAt)}</span></li>)}</ul>
    <div className="decision">
      <label>{t('decisionReason')}<select value={reason} onChange={event => setReason(event.target.value)}>
        {reasons.map(value => <option key={value} value={value}>{t('reason.' + value)}</option>)}</select></label>
      <label>{t('decisionComment')}<input value={comment} maxLength={1000} onChange={event => setComment(event.target.value)}/></label>
      <div className="actions">
        {target && !target.hiddenAt && <button type="button" className="button" onClick={() => decide('HIDE', false, t('hide'))}>{t('hide')}</button>}
        {target && !target.hiddenAt && mayBan && <button type="button" className="button danger" onClick={() => decide('HIDE', true, t('hideAndBan'))}>{t('hideAndBan')}</button>}
        {target && <button type="button" className="button danger" onClick={() => decide('DELETE', false, t('delete'))}>{t('delete')}</button>}
        {mayBan && <button type="button" className="button danger" onClick={() => decide('NONE', true, t('banAuthor'))}>{t('banAuthor')}</button>}
        {(!target || target.hiddenAt) && <button type="button" className="button" onClick={() => decide('NONE', false, t('markResolved'))}>{t('markResolved')}</button>}
        <button type="button" className="button ghost" onClick={() => decide('DISMISS', false, t('dismiss'))}>{t('dismiss')}</button>
      </div>
    </div>
    {ask && <ReasonDialog ask={ask} onClose={() => setAsk(null)}/>}
  </article></li>;
}
export function ModerationQueue() {
  const {t, has} = useT(), [page, setPage] = useState(1);
  const {result, query} = useCustom<Queue>({url: '/api/moderation/queue', method: 'get', config: {query: {page: String(page)}}});
  const groups = result.data?.data ?? [], total = result.data?.total ?? 0, pages = Math.max(1, Math.ceil(total / pageSize));
  return <>
    <h1>{t('nav.queue')}</h1>
    <p className="muted">{t('queueIntro')}</p>
    {query.isError && <p role="alert" className="error">{has('error.' + errorCode(query.error)) ? t('error.' + errorCode(query.error)) : t('error.GENERIC')}</p>}
    <p role="status" className="muted">{query.isLoading ? t('loading') : t('queueTotal', {count: total})}</p>
    {!query.isLoading && !query.isError && !groups.length && <p className="success">{t('queueEmpty')}</p>}
    <ul className="cards">{groups.map(group => <Card key={group.key + ':' + group.reports.length} group={group} onDone={() => void query.refetch()}/>)}</ul>
    {pages > 1 && <nav className="pager" aria-label={t('pagination')}>
      <button type="button" className="button ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('previous')}</button>
      <span>{t('pageOf', {page, pages})}</span>
      <button type="button" className="button ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('next')}</button>
    </nav>}
  </>;
}
