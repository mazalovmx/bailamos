'use client';
import {useLocale, useTranslations} from 'next-intl';
import {useRouter} from 'next/navigation';
import {useState} from 'react';
import {send, useStatus, type Option} from './shared';
import '../../app/styles/account.css';
const types = ['DANCER','ORGANIZER','SCHOOL','VENUE','ARTIST'], roles = ['LEADER','FOLLOWER','BOTH'], levels = ['NEWCOMER','BEGINNER','INTERMEDIATE','ADVANCED','PRO'];
export type ProfileFields = {name: string; handle: string; bio: string; cityId: string; district: string; instagram: string; type: string};
export function ProfileForm({cities, initial}: {cities: Option[]; initial: ProfileFields}) {
  const t = useTranslations('Account'), app = useTranslations('App'), locale = useLocale(), router = useRouter(), s = useStatus();
  const [saved, setSaved] = useState('');
  return <form className="editor-form" onSubmit={e => {e.preventDefault(); const form = e.currentTarget; setSaved('');
    s.run(async () => {
      const result = await send('/api/profile', 'PUT', Object.fromEntries(new FormData(form)));
      setSaved(result.handle); router.refresh();
    });}}>
    <div className="form-grid">
      <label>{app('name')}<input name="name" defaultValue={initial.name} required minLength={2} maxLength={80} autoComplete="name"/></label>
      <label>{app('handle')}<input name="handle" defaultValue={initial.handle} pattern="[a-z0-9][a-z0-9_\-]{2,29}" required minLength={3} maxLength={30}
        autoCapitalize="none" spellCheck={false} aria-describedby="handle-hint"/><small id="handle-hint">{app('handleHint')}</small></label>
      <label>{app('profileType')}<select name="type" defaultValue={initial.type || 'DANCER'} required>
        {types.map(id => <option key={id} value={id}>{app(id)}</option>)}</select></label>
      <label>{app('city')}<select name="cityId" defaultValue={initial.cityId} required><option value="">{app('choose')}</option>
        {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>{t('district')}<input name="district" defaultValue={initial.district} maxLength={80} aria-describedby="district-hint"/>
        <small id="district-hint">{t('districtHint')}</small></label>
      <label>{t('instagram')}<input name="instagram" defaultValue={initial.instagram} maxLength={31} pattern="@?[A-Za-z0-9._]{1,30}"
        autoCapitalize="none" spellCheck={false} aria-describedby="instagram-hint"/><small id="instagram-hint">{t('instagramHint')}</small></label>
    </div>
    <label>{app('bio')}<textarea name="bio" defaultValue={initial.bio} maxLength={1000} rows={4}/></label>
    {s.feedback}
    {saved && <p className="notice" role="status">{t('profileSaved')} <a href={'/' + locale + '/@' + saved}>{t('viewPublic')}</a></p>}
    <button className="button" disabled={s.busy}>{app(s.busy ? 'working' : 'saveProfile')}</button>
  </form>;
}
export type SkillRow = {styleId: string; role: string; level: string; lookingFor: boolean};
export function SkillsEditor({styles, initial}: {styles: Option[]; initial: SkillRow[]}) {
  const t = useTranslations('Account'), app = useTranslations('App'), router = useRouter(), s = useStatus();
  const [rows, setRows] = useState(() => initial.map((row, i) => ({...row, key: i})));
  const [next, setNext] = useState(initial.length), [saved, setSaved] = useState(false);
  const change = (key: number, patch: Partial<SkillRow>) => {setSaved(false); setRows(list => list.map(row => row.key === key ? {...row, ...patch} : row));};
  const duplicate = new Set(rows.map(r => r.styleId + ':' + r.role)).size !== rows.length;
  return <form className="editor-form skills-editor" onSubmit={e => {e.preventDefault(); setSaved(false);
    if (duplicate) {s.setError('DUPLICATE_SKILL'); return;}
    s.run(async () => {
      await send('/api/profile/skills', 'PUT', {skills: rows.map(({styleId, role, level, lookingFor}) => ({styleId, role, level, lookingFor}))});
      setSaved(true); router.refresh();
    });}}>
    {!rows.length && <p className="field-note">{t('noSkills')}</p>}
    {rows.map((row, index) => <fieldset key={row.key} className="skill-row"><legend>{t('skillNumber', {number: index + 1})}</legend>
      <div className="skill-fields">
        <label>{app('style')}<select value={row.styleId} required onChange={e => change(row.key, {styleId: e.target.value})}><option value="">{app('choose')}</option>
          {styles.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label>{app('role')}<select value={row.role} required onChange={e => change(row.key, {role: e.target.value})}><option value="">{app('choose')}</option>
          {roles.map(id => <option key={id} value={id}>{app(id)}</option>)}</select></label>
        <label>{app('level')}<select value={row.level} required onChange={e => change(row.key, {level: e.target.value})}><option value="">{app('choose')}</option>
          {levels.map(id => <option key={id} value={id}>{app(id)}</option>)}</select></label>
      </div>
      <label className="checkbox"><input type="checkbox" checked={row.lookingFor} onChange={e => change(row.key, {lookingFor: e.target.checked})}/>
        <span>{t('lookingFor')}</span></label>
      <button type="button" className="button secondary" onClick={() => {setSaved(false); setRows(list => list.filter(r => r.key !== row.key));}}>
        {t('removeSkill')}<span className="visually-hidden"> {index + 1}</span></button>
    </fieldset>)}
    <p className="field-note">{t('lookingForHint')}</p>
    {/* A new skill always starts with partner search off: only the owner's own tick turns it on. */}
    <button type="button" className="button secondary" disabled={rows.length >= 20}
      onClick={() => {setSaved(false); setRows(list => [...list, {styleId: '', role: '', level: '', lookingFor: false, key: next}]); setNext(next + 1);}}>{t('addSkill')}</button>
    {s.feedback}
    {saved && <p className="notice" role="status">{t('skillsSaved')}</p>}
    <button className="button" disabled={s.busy}>{s.busy ? app('working') : t('saveSkills')}</button>
  </form>;
}
