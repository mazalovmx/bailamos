'use client';
import {useEffect, useMemo, useState} from 'react';
import {useCreate, useList, useOne, useUpdate} from '@refinedev/core';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ApiFailure, errorCode} from '../lib/data-provider';
import type {FieldMeta} from '../lib/resources';
import {Cell, mediaUrl} from './cells';
import {useT} from './i18n';
import {targetResources, usePanel, useResourceMeta, type Row} from './panel';
import {RowActions} from './row-actions';
type Values = Record<string, string>;
// Small catalogues are picked from a list; everything else is referenced by identifier.
const selectable = new Set(['cities', 'styles', 'import-sources']);
const toInput = (value: unknown) => value === null || value === undefined ? '' : String(value);
function fromInput(field: FieldMeta, value: string): unknown {
  if (value === '' && field.nullable) return null;
  if (field.type === 'number') return value === '' ? undefined : Number(value);
  if (field.type === 'boolean') return value === 'true';
  return value;
}
function RefSelect({field, value, onChange, exclude, id, invalid}: {field: FieldMeta; value: string; onChange: (value: string) => void; exclude?: string; id: string; invalid: boolean}) {
  const {t} = useT(), meta = useResourceMeta(field.ref as string);
  const {result} = useList<Row>({resource: meta.name, pagination: {mode: 'off'}, sorters: [{field: meta.label, order: 'asc'}]});
  // A style can become a child of anything except itself and its own descendants.
  const options = useMemo(() => {
    const rows = result.data ?? [];
    if (!exclude) return rows;
    const banned = new Set([exclude]);
    for (let grew = true; grew;) {
      grew = false;
      for (const row of rows) if (typeof row.parentId === 'string' && banned.has(row.parentId) && !banned.has(row.id)) {banned.add(row.id); grew = true;}
    }
    return rows.filter(row => !banned.has(row.id));
  }, [result.data, exclude]);
  return <select id={id} value={value} required={field.required && !field.nullable} aria-invalid={invalid || undefined} onChange={event => onChange(event.target.value)}>
    <option value="">{field.nullable ? t('none') : t('choose')}</option>
    {value && !options.some(row => row.id === value) && <option value={value}>{value}</option>}
    {options.map(row => <option key={row.id} value={row.id}>{String(row[meta.label] ?? row.id)}</option>)}
  </select>;
}
function Input({field, value, onChange, id, invalid, self}: {field: FieldMeta; value: string; onChange: (value: string) => void; id: string; invalid: boolean; self?: string}) {
  const {t} = useT(), common = {id, value, 'aria-invalid': invalid || undefined, onChange: (event: {target: {value: string}}) => onChange(event.target.value)};
  const required = field.required && !field.nullable;
  if (field.ref && selectable.has(field.ref)) return <RefSelect field={field} value={value} onChange={onChange} id={id} invalid={invalid} exclude={field.name === 'parentId' ? self : undefined}/>;
  if (field.type === 'enum') return <select {...common} required={required}>
    {(field.nullable || !value) && <option value="">{field.nullable ? t('none') : t('choose')}</option>}
    {field.values?.map(option => <option key={option} value={option}>{option}</option>)}</select>;
  if (field.type === 'boolean') return <select {...common}>
    {field.nullable && <option value="">{t('unknown')}</option>}<option value="true">{t('yes')}</option><option value="false">{t('no')}</option></select>;
  if (field.type === 'text') return <textarea {...common} rows={6} maxLength={field.max ?? 20000} required={required}/>;
  if (field.type === 'number') return <input {...common} type="number" step="any" min={field.min} max={field.max} required={required}/>;
  return <input {...common} required={required} minLength={field.min} maxLength={field.max ?? 300} pattern={field.pattern}/>;
}
export function ResourceForm({name, id}: {name: string; id?: string}) {
  const meta = useResourceMeta(name), {t, has} = useT(), {webUrl} = usePanel(), {locale} = useT(), router = useRouter();
  const {result: row, query} = useOne<Row>({resource: name, id: id ?? '', queryOptions: {enabled: !!id}});
  const {mutate: create, mutation: creating} = useCreate<Row>(), {mutate: update, mutation: updating} = useUpdate<Row>();
  const editable = useMemo(() => meta.fields.filter(field => field.write), [meta]);
  const canSave = id ? meta.canUpdate : meta.canCreate;
  const [values, setValues] = useState<Values>({}), [error, setError] = useState(''), [invalid, setInvalid] = useState<string[]>([]), [saved, setSaved] = useState(false);
  useEffect(() => {
    if (row) setValues(Object.fromEntries(editable.map(field => [field.name, toInput(row[field.name])])));
    else if (!id) setValues(Object.fromEntries(editable.map(field => [field.name, field.type === 'boolean' && !field.nullable ? 'false' : ''])));
  }, [row, id, editable]);
  const label = (field: FieldMeta) => has('field.' + field.name) ? t('field.' + field.name) : field.name;
  const failed = (failure: unknown) => {
    const code = errorCode(failure);
    setInvalid(failure instanceof ApiFailure ? failure.fields : []);
    setError(has('error.' + code) ? t('error.' + code) : t('error.GENERIC'));
  };
  function submit() {
    setError(''); setInvalid([]); setSaved(false);
    // Only what actually changed is sent, so the audit log records the real edit.
    const changed = editable.filter(field => !id || values[field.name] !== toInput(row?.[field.name]))
      .map(field => [field.name, fromInput(field, values[field.name] ?? '')] as const).filter(([, value]) => value !== undefined && (id || value !== null));
    if (!changed.length) {setError(t('noChanges')); return;}
    const variables = Object.fromEntries(changed);
    if (id) update({resource: name, id, values: variables}, {onSuccess: () => {setSaved(true); void query.refetch();}, onError: failed});
    else create({resource: name, values: variables}, {onSuccess: response => router.push('/r/' + name + '/' + encodeURIComponent(String(response.data.id))), onError: failed});
  }
  const title = id ? String(row?.[meta.label] ?? row?.id ?? id) : t('createTitle', {resource: t('resource.' + name)});
  const target = Object.entries(targetResources).find(([, resource]) => resource === name)?.[0];
  if (id && query.isError) return <><p><Link href={'/r/' + name}>← {t('resource.' + name)}</Link></p>
    <p role="alert" className="error">{has('error.' + errorCode(query.error)) ? t('error.' + errorCode(query.error)) : t('error.GENERIC')}</p></>;
  return <>
    <p><Link href={'/r/' + name}>← {t('resource.' + name)}</Link></p>
    <div className="heading"><h1>{title}</h1>
      {row && <RowActions meta={meta} row={row} onDone={() => void query.refetch()} onDeleted={() => router.push('/r/' + name)}/>}</div>
    {id && query.isLoading && <p role="status" className="muted">{t('loading')}</p>}
    {row?.hiddenAt ? <p className="notice">{t('hiddenNotice')}</p> : null}
    {row?.bannedAt ? <p className="notice">{t('bannedNotice')}</p> : null}
    {row && name === 'media' && typeof row.storageKey === 'string' && <p><a href={mediaUrl(webUrl, row.storageKey)} target="_blank" rel="noreferrer">{t('openOriginal')}</a></p>}
    {row && name === 'events' && typeof row.slug === 'string' && <p><a href={webUrl + '/' + locale + '/events/' + row.slug} target="_blank" rel="noreferrer">{t('openOnSite')}</a></p>}
    {row && name === 'profiles' && typeof row.handle === 'string' && <p><a href={webUrl + '/' + locale + '/people/' + row.handle} target="_blank" rel="noreferrer">{t('openOnSite')}</a></p>}
    {row && target && <p><Link href={'/r/reports?targetType=' + target + '&targetId__contains=' +encodeURIComponent(row.id)}>{t('reportsOnThis')}</Link></p>}
    {canSave && editable.length > 0 && (!id || row) && <form className="record" onSubmit={event => {event.preventDefault(); submit();}}>
      {editable.map(field => <div key={field.name} className="field">
        <label htmlFor={'f-' + field.name}>{label(field)}{field.required && !field.nullable ? ' *' : ''}</label>
        <Input field={field} id={'f-' + field.name} value={values[field.name] ?? ''} invalid={invalid.includes(field.name)} self={id}
          onChange={value => setValues(current => ({...current, [field.name]: value}))}/>
      </div>)}
      {error && <p role="alert" className="error">{error}{invalid.length ? ' ' + invalid.map(field => has('field.' + field) ? t('field.' + field) : field).join(', ') : ''}</p>}
      {saved && <p role="status" className="success">{t('saved')}</p>}
      <div className="actions"><button className="button" disabled={creating.isPending || updating.isPending}>{t(creating.isPending || updating.isPending ? 'working' : id ? 'save' : 'create')}</button></div>
    </form>}
    {row && <section aria-labelledby="details"><h2 id="details">{t('details')}</h2>
      <dl className="details">{meta.fields.filter(field => !(canSave && field.write)).map(field =>
        <div key={field.name}><dt>{label(field)}</dt><dd><Cell field={field} row={row} full/></dd></div>)}</dl></section>}
  </>;
}
