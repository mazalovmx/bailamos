'use client';
import {useMemo, useState} from 'react';
import {useList, type CrudFilter, type CrudOperators} from '@refinedev/core';
import Link from 'next/link';
import {errorCode} from '../lib/data-provider';
import type {FieldMeta} from '../lib/resources';
import {Cell} from './cells';
import {useT} from './i18n';
import {useResourceMeta, type Row} from './panel';
import {RowActions} from './row-actions';
const pageSize = 25;
// Parents first, children indented beneath them; rows whose parent is not on the page stay at the top level.
function treeOrder(rows: Row[]) {
  const ids = new Set(rows.map(row => row.id)), out: {row: Row; depth: number}[] = [], seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const row of rows) {
      const own = typeof row.parentId === 'string' && ids.has(row.parentId) ? row.parentId : null;
      if (own !== parent || seen.has(row.id)) continue;
      seen.add(row.id); out.push({row, depth}); walk(row.id, depth + 1);
    }
  };
  walk(null, 0);
  return [...out, ...rows.filter(row => !seen.has(row.id)).map(row => ({row, depth: 0}))];
}
// A nullable date such as hiddenAt or bannedAt is filtered as a state: set or not set.
const stateFilter = (field: FieldMeta) => field.type === 'date' && field.nullable;
export function ResourceList({name, initial}: {name: string; initial: Record<string, string>}) {
  const meta = useResourceMeta(name), {t, has} = useT();
  const [page, setPage] = useState(1), [search, setSearch] = useState(''), [filters, setFilters] = useState(initial);
  const [sort, setSort] = useState<{field: string; order: 'asc' | 'desc'} | null>(null);
  const active = Object.entries(filters).filter(([, value]) => value !== '');
  const tree = meta.tree && !search && !active.length;
  const crud: CrudFilter[] = [...(search ? [{field: 'q', operator: 'eq' as const, value: search}] : []),
    ...active.map(([key, value]) => {const [field, operator = 'eq'] = key.split('__'); return {field, operator: operator as Exclude<CrudOperators, 'or' | 'and'>, value};})];
  const {result, query} = useList<Row>({resource: name, pagination: tree ? {mode: 'off'} : {currentPage: page, pageSize}, sorters: sort && !tree ? [sort] : [], filters: crud});
  const rows = useMemo(() => tree ? treeOrder(result.data ?? []) : (result.data ?? []).map(row => ({row, depth: 0})), [tree, result.data]);
  const total = result.total ?? 0, pages = tree ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const columns = meta.fields.filter(field => field.list), label = (field: FieldMeta) => has('field.' + field.name) ? t('field.' + field.name) : field.name;
  const change = (key: string, value: string) => {setFilters(current => ({...current, [key]: value})); setPage(1);};
  const title = t('resource.' + name);
  return <>
    <div className="heading"><h1>{title}</h1>
      {meta.canCreate && <Link className="button" href={'/r/' + name + '/new'}>{t('create')}</Link>}</div>
    <form className="filters" role="search" aria-label={t('filters')} onSubmit={event => {event.preventDefault();
      setSearch(String(new FormData(event.currentTarget).get('q') ?? '').trim()); setPage(1);}}>
      {meta.searchable && <label>{t('search')}<input name="q" type="search" defaultValue={search} maxLength={200}/></label>}
      {meta.fields.filter(field => field.filter && field.name !== 'id' && (field.type !== 'date' || field.nullable) && field.type !== 'number').map(field => {
        // Free-text columns match by substring; identifiers and enumerations match exactly.
        const key = stateFilter(field) ? field.name + '__null' : field.type === 'string' && !field.ref ? field.name + '__contains' : field.name;
        return <label key={field.name}>{label(field)}
          {field.type === 'enum' ? <select value={filters[key] ?? ''} onChange={event => change(key, event.target.value)}>
            <option value="">{t('any')}</option>{field.values?.map(value => <option key={value} value={value}>{value}</option>)}</select>
          : field.type === 'boolean' ? <select value={filters[key] ?? ''} onChange={event => change(key, event.target.value)}>
            <option value="">{t('any')}</option><option value="true">{t('yes')}</option><option value="false">{t('no')}</option></select>
          : stateFilter(field) ? <select value={filters[key] ?? ''} onChange={event => change(key, event.target.value)}>
            <option value="">{t('any')}</option><option value="false">{t('isSet')}</option><option value="true">{t('notSet')}</option></select>
          : <input value={filters[key] ?? ''} onChange={event => change(key, event.target.value.trim())} maxLength={200}/>}
        </label>;
      })}
      {meta.searchable && <button className="button">{t('find')}</button>}
      {(search || active.length > 0) && <button type="reset" className="button ghost" onClick={() => {setSearch(''); setFilters({}); setPage(1);}}>{t('reset')}</button>}
    </form>
    {query.isError && <p role="alert" className="error">{has('error.' + errorCode(query.error)) ? t('error.' + errorCode(query.error)) : t('error.GENERIC')}</p>}
    <p className="muted" role="status">{query.isLoading ? t('loading') : t('total', {count: total})}</p>
    <div className="table-wrap"><table>
      <caption className="sr-only">{title}</caption>
      <thead><tr>
        {columns.map(field => <th key={field.name} scope="col" aria-sort={sort?.field === field.name ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined}>
          {field.sort && !tree ? <button type="button" className="sort" onClick={() => {
            setSort(current => current?.field === field.name && current.order === 'asc' ? {field: field.name, order: 'desc'} : {field: field.name, order: 'asc'}); setPage(1);
          }}>{label(field)}{sort?.field === field.name ? (sort.order === 'asc' ? ' ▲' : ' ▼') : ''}</button> : label(field)}</th>)}
        <th scope="col">{t('actions')}</th>
      </tr></thead>
      <tbody>
        {rows.map(({row, depth}) => <tr key={row.id} className={row.hiddenAt || row.bannedAt ? 'dimmed' : undefined}>
          {columns.map((field, index) => <td key={field.name} style={index === 0 && depth ? {paddingLeft: 12 + depth * 24} : undefined}>
            {index === 0 && depth > 0 && <span aria-hidden="true">└ </span>}<Cell field={field} row={row}/></td>)}
          <td><div className="actions"><Link className="button small" href={'/r/' + name + '/' + encodeURIComponent(row.id)}>{t(meta.canUpdate ? 'edit' : 'open')}</Link>
            <RowActions meta={meta} row={row} onDone={() => void query.refetch()}/></div></td>
        </tr>)}
        {!query.isLoading && !rows.length && <tr><td colSpan={columns.length + 1} className="muted">{t('noRows')}</td></tr>}
      </tbody>
    </table></div>
    {pages > 1 && <nav className="pager" aria-label={t('pagination')}>
      <button type="button" className="button ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('previous')}</button>
      <span>{t('pageOf', {page, pages})}</span>
      <button type="button" className="button ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('next')}</button>
    </nav>}
  </>;
}
