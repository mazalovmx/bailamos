'use client';
import Link from 'next/link';
import type {FieldMeta} from '../lib/resources';
import {useT} from './i18n';
import {usePanel, type Row} from './panel';
const imageKeys = new Set(['storageKey', 'avatarKey', 'coverKey']);
export const mediaUrl = (webUrl: string, key: string) => webUrl + '/api/media/file/' + key.split('/').map(encodeURIComponent).join('/');
export function useDate() {
  const {locale} = useT();
  return (value: unknown) => typeof value === 'string' || value instanceof Date ? new Date(value).toLocaleString(locale, {dateStyle: 'medium', timeStyle: 'short'}) : '';
}
// Read-only rendering of one whitelisted value. `full` is the record page, otherwise a table cell.
export function Cell({field, row, full}: {field: FieldMeta; row: Row; full?: boolean}) {
  const {t} = useT(), {webUrl} = usePanel(), date = useDate(), value = row[field.name];
  if (value === null || value === undefined || value === '') return <span className="muted" aria-label={t('empty')}>—</span>;
  if (field.type === 'boolean') return <>{t(value ? 'yes' : 'no')}</>;
  if (field.type === 'date') return <time dateTime={String(value)}>{date(value)}</time>;
  if (field.type === 'json') {
    const text = JSON.stringify(value, null, full ? 2 : undefined);
    return full ? <pre>{text}</pre> : <code title={text.slice(0, 2000)}>{text.length > 90 ? text.slice(0, 90) + '…' : text}</code>;
  }
  if (field.ref) return <Link href={'/r/' + field.ref + '/' + encodeURIComponent(String(value))}>{row._labels?.[field.name] ?? String(value)}</Link>;
  if (imageKeys.has(field.name)) {
    const url = mediaUrl(webUrl, String(value));
    return <a href={url} target="_blank" rel="noreferrer">
      <img className={full ? 'preview' : 'thumb'} src={url} alt={typeof row.alt === 'string' && row.alt ? row.alt : t('mediaPreview')} loading="lazy"/>
      {full && <span className="muted"> {String(value)}</span>}
    </a>;
  }
  const text = String(value);
  if (field.type === 'enum') return <span className="badge">{text}</span>;
  if (full) return <span className="pre">{text}</span>;
  return <span title={text.length > 120 ? text.slice(0, 1000) : undefined}>{text.length > 120 ? text.slice(0, 120) + '…' : text}</span>;
}
