'use client';
import {useState} from 'react';
import Link from 'next/link';
import {api} from '../lib/data-provider';
import type {ResourceMeta} from '../lib/resources';
import {useT} from './i18n';
import {usePanel, type Row} from './panel';
import {ReasonDialog, type Ask} from './reason-dialog';
const roles = ['USER', 'MODERATOR', 'SCHOOL_ADMIN', 'ADMIN'];
// Audited actions available on a record: visibility, deletion, bans, roles and import review.
export function RowActions({meta, row, onDone, onDeleted}: {meta: ResourceMeta; row: Row; onDone: () => void; onDeleted?: () => void}) {
  const {t} = useT(), {user} = usePanel();
  const [ask, setAsk] = useState<Ask | null>(null);
  const name = String(row[meta.label] ?? row.id), id = encodeURIComponent(row.id);
  const done = async (work: Promise<unknown>, after = onDone) => {await work; after();};
  const visibility = (hidden: boolean) => setAsk({title: t(hidden ? 'confirmHide' : 'confirmUnhide', {name}), confirm: t(hidden ? 'hide' : 'unhide'), reason: 'required',
    run: reason => done(api('/api/moderation/visibility', {method: 'POST', body: {targetType: meta.hide, targetId: row.id, hidden, reason}}))});
  const ban = (banned: boolean) => setAsk({title: t(banned ? 'confirmBan' : 'confirmUnban', {name}), text: banned ? t('banText') : undefined,
    confirm: t(banned ? 'ban' : 'unban'), danger: banned, reason: 'required',
    run: reason => done(api('/api/users/' + id + '/ban', {method: 'POST', body: {banned, reason}}))});
  const review = (approve: boolean) => setAsk({title: t(approve ? 'confirmImportApprove' : 'confirmImportReject', {name}), confirm: t(approve ? 'approve' : 'reject'),
    reason: approve ? 'none' : 'optional', run: note => done(api('/api/imported-items/' + id, {method: 'POST', body: {approve, note: note || undefined}}))});
  const self = meta.name === 'users' && row.id === user.id;
  // Moderators cannot ban staff; the server enforces the same rule.
  const protectedRole = row.role === 'OWNER' || (row.role === 'ADMIN' && user.role !== 'OWNER');
  const mayBan = meta.name === 'users' && !self && !protectedRole && (['OWNER','ADMIN'].includes(user.role) || row.role === 'USER');
  return <div className="actions">
    {meta.hide && (row.hiddenAt ? <button type="button" className="button small" onClick={() => visibility(false)}>{t('unhide')}</button>
      : <button type="button" className="button small" onClick={() => visibility(true)}>{t('hide')}</button>)}
    {mayBan && (row.bannedAt ? <button type="button" className="button small" onClick={() => ban(false)}>{t('unban')}</button>
      : <button type="button" className="button small danger" onClick={() => ban(true)}>{t('ban')}</button>)}
    {meta.name === 'users' && ['OWNER','ADMIN'].includes(user.role) && !self && !protectedRole && <label className="inline"><span className="sr-only">{t('field.role')}: {name}</span>
      <select value={String(row.role)} onChange={event => {
        const role = event.target.value;
        setAsk({title: t('confirmRole', {name, role}), confirm: t('changeRole'), reason: 'none',
          run: () => done(api('/api/users/' + id + '/role', {method: 'POST', body: {role}}))});
      }}>{roles.filter(role=>role!=='ADMIN'||user.role==='OWNER').map(role => <option key={role} value={role}>{role}</option>)}</select></label>}
    {meta.name === 'imported-items' && row.status === 'REVIEW' && <>
      <button type="button" className="button small" onClick={() => review(true)}>{t('approve')}</button>
      <button type="button" className="button small" onClick={() => review(false)}>{t('reject')}</button></>}
    {meta.name === 'reports' && row.status === 'OPEN' && <Link className="button small" href="/moderation">{t('nav.queue')}</Link>}
    {meta.name === 'claims' && row.status === 'PENDING' && <Link className="button small" href="/claims">{t('nav.claims')}</Link>}
    {meta.name === 'conversations' && <Link className="button small" href={'/r/messages?conversationId=' + id}>{t('resource.messages')}</Link>}
    {meta.canDelete && <button type="button" className="button small danger" onClick={() => setAsk({title: t('confirmDelete', {name}), text: t('deleteText'),
      confirm: t('delete'), danger: true, reason: meta.hide ? 'required' : 'optional',
      run: reason => done(api('/api/resources/' + meta.name + '/' + id, {method: 'DELETE', body: reason ? {reason} : {}}), onDeleted ?? onDone)})}>{t('delete')}</button>}
    {ask && <ReasonDialog ask={ask} onClose={() => setAsk(null)}/>}
  </div>;
}
