'use client';
import {useEffect, useId, useRef, useState} from 'react';
import {api, errorCode} from '../lib/data-provider';
import {useT} from './i18n';
import {usePanel} from './panel';

type Added = {email: string; loginUrl: string; scope: 'global' | 'school'; role: 'ADMIN' | 'MODERATOR' | 'MANAGER'; schoolId?: string};
type School = {id: string; name: string};
function AddAdminDialog({onClose, onAdded}: {onClose: () => void; onAdded: () => void}) {
  const {t, has} = useT(), dialog = useRef<HTMLDialogElement>(null), titleId = useId(), helpId = useId();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [added, setAdded] = useState<Added | null>(null);
  const [copied, setCopied] = useState(false);
  const [scope, setScope] = useState(''), [role, setRole] = useState('ADMIN'), [schoolId, setSchoolId] = useState('');
  const [schools, setSchools] = useState<School[]>([]), [loadingSchools, setLoadingSchools] = useState(true);
  useEffect(() => {dialog.current?.showModal();}, []);
  useEffect(() => {
    let active = true;
    void api<School[]>('/api/schools').then(result => {if (active) setSchools(result);})
      .catch(() => {if (active) setError(t('error.GENERIC'));}).finally(() => {if (active) setLoadingSchools(false);});
    return () => {active = false;};
  }, [t]);
  return <dialog className="add-admin-dialog" ref={dialog} aria-labelledby={titleId} onClose={onClose} onCancel={event => {if (busy) event.preventDefault();}}>
    <form onSubmit={async event => {
      event.preventDefault();
      const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
      setBusy(true); setError('');
      try {
        const result = await api<Added>('/api/users', {method: 'POST', body: {email, scope, role, ...(scope === 'school' ? {schoolId} : {})}});
        setAdded(result); onAdded();
      } catch (failure) {
        const code = errorCode(failure); setError(has('error.' + code) ? t('error.' + code) : t('error.GENERIC'));
      } finally {setBusy(false);}
    }}>
      <h2 id={titleId}>{t('addAdminTitle')}</h2>
      {added ? <>
        <p className="success" role="status">{t('adminAdded', {email: added.email})}</p>
        <p>{added.scope === 'school' ? schools.find(school => school.id === added.schoolId)?.name : t('access.global')} · {t(added.scope === 'school' ? 'school.role.' + added.role : 'role.' + added.role)}</p>
        <p>{t('adminAddedHelp')}</p>
        <p className="pre"><a href={added.loginUrl}>{added.loginUrl}</a></p>
        <div className="actions">
          <button type="button" className="button ghost" onClick={async () => {
            try {await navigator.clipboard.writeText(added.loginUrl); setCopied(true); setError('');}
            catch {setError(t('copyLinkFailed'));}
          }}>{t(copied ? 'linkCopied' : 'copyLoginLink')}</button>
          <button type="button" className="button" onClick={() => dialog.current?.close()}>{t('close')}</button>
        </div>
      </> : <>
        <p id={helpId}>{t('addAdminHelp')}</p>
        <label>{t('email')}<input name="email" type="email" required maxLength={254} autoComplete="email" autoFocus aria-describedby={helpId} disabled={busy}/></label>
        <label>{t('access.scope')}<select name="scope" value={scope} required disabled={busy} onChange={event => {setScope(event.target.value); setRole('ADMIN');}}>
          <option value="">{t('access.choose')}</option><option value="global">{t('access.global')}</option><option value="school">{t('access.school')}</option>
        </select></label>
        {scope === 'school' && <label>{t('school.choose')}<select name="schoolId" value={schoolId} required disabled={busy || loadingSchools} onChange={event => setSchoolId(event.target.value)}>
          <option value="">{t(loadingSchools ? 'working' : schools.length ? 'school.choosePrompt' : 'school.empty')}</option>
          {schools.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}
        </select></label>}
        {scope && <><label>{t('field.role')}<select name="role" value={role} disabled={busy} onChange={event => setRole(event.target.value)}>
          <option value="ADMIN">{t(scope === 'school' ? 'school.role.ADMIN' : 'role.ADMIN')}</option>
          <option value={scope === 'school' ? 'MANAGER' : 'MODERATOR'}>{t(scope === 'school' ? 'school.role.MANAGER' : 'role.MODERATOR')}</option>
        </select></label><p>{t(scope === 'school' ? 'access.schoolHelp' : 'access.globalHelp')}</p></>}
        <div className="actions">
          <button className="button" disabled={busy || !scope || (scope === 'school' && !schoolId)}>{busy ? t('working') : t('addUser')}</button>
          <button type="button" className="button ghost" disabled={busy} onClick={() => dialog.current?.close()}>{t('cancel')}</button>
        </div>
      </>}
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  </dialog>;
}

export function AddAdmin({onAdded}: {onAdded: () => void}) {
  const {user} = usePanel(), {t} = useT(), [open, setOpen] = useState(false);
  if (user.role !== 'OWNER') return null;
  return <>
    <button type="button" className="button" onClick={() => setOpen(true)}>{t('addUser')}</button>
    {open && <AddAdminDialog onClose={() => setOpen(false)} onAdded={onAdded}/>}
  </>;
}
