import Link from 'next/link';
import {getTranslations} from 'next-intl/server';
import {mediaUrl} from '../../lib/account/media';
import type {Contact} from '../../lib/matching/interest';
import {ReportButton} from '../moderation/report-button';
import {MessageButton} from '../chat/message-button';
import {BlockButton, WithdrawButton} from './actions';
// Server-rendered pieces shared by the three partner pages.
export async function PartnersNav({locale, current}: {locale: string; current: 'search' | 'matches' | 'sent'}) {
  const t = await getTranslations('Matching'), base = '/' + locale + '/partners';
  const items = [['search', base], ['matches', base + '/matches'], ['sent', base + '/sent']] as const;
  return <nav className="partner-nav" aria-label={t('navLabel')}><ul>{items.map(([key, href]) =>
    <li key={key}><Link href={href} aria-current={key === current ? 'page' : undefined}>{t('nav_' + key)}</Link></li>)}</ul></nav>;
}
// The name is next to the picture in every card, so the picture itself is decorative.
export function Avatar({name, avatarKey}: {name: string; avatarKey: string | null}) {
  return avatarKey ? <img className="partner-avatar" src={mediaUrl(avatarKey)} alt="" width={64} height={64} loading="lazy"/> :
    <div className="partner-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div>;
}
export async function ContactList({locale, contacts, matched}: {locale: string; contacts: Contact[]; matched: boolean}) {
  const t = await getTranslations('Matching');
  return <ul className="partner-list">{contacts.map(contact => <li key={contact.profileId}><article className="partner-card" aria-labelledby={'contact-' + contact.profileId}>
    <div className="partner-head"><Avatar name={contact.name} avatarKey={contact.avatarKey}/>
      <div><h2 id={'contact-' + contact.profileId}><Link href={'/' + locale + '/@' + contact.handle}>{contact.name}</Link></h2>
        <p className="partner-meta">@{contact.handle}{contact.city ? ' · ' + [contact.city, contact.district].filter(Boolean).join(', ') : ''}</p></div></div>
    <p className="partner-meta">{contact.style ? t('interestStyle', {style: contact.style}) + ' · ' : ''}
      {t('since', {date: new Intl.DateTimeFormat(locale, {dateStyle: 'medium'}).format(new Date(contact.since))})}</p>
    <div className="partner-buttons">
      {/* A mutual PartnerInterest makes the two "known" to each other in lib/chat/policy.ts, so this opens a normal conversation. */}
      {matched && <MessageButton profileId={contact.profileId} signedIn/>}
      <WithdrawButton profileId={contact.profileId} name={contact.name}/>
    </div>
    <div className="partner-safety"><ReportButton targetType="PROFILE" targetId={contact.profileId} signedIn/>
      <BlockButton profileId={contact.profileId} name={contact.name}/></div>
  </article></li>)}</ul>;
}
