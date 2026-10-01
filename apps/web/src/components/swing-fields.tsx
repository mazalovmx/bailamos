'use client';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {eventKinds,danceFormats,classLevels,intensities,tempos} from '../lib/swing';
// Classification of a class or party. Dates and repetition live in events/schedule-fields.
export function SwingFields({initial,tags,selectedTags}:{initial:Record<string,string>;tags:{id:string;name:string}[];selectedTags:string[]}) {
  const t=useTranslations('App'),[format,setFormat]=useState(initial.format||'PARTNER');
  function options(name:string,label:string,prefix:string,items:readonly string[],fallback:string) {
    return <label>{t(label)}<select name={name} defaultValue={initial[name]||fallback}>{items.map(value=><option key={value} value={value}>{t(prefix+value)}</option>)}</select></label>;
  }
  return <>
    <div className="form-grid">{options('kind','kind','kind_',eventKinds,'CLASS')}
      <label>{t('format')}<select name="format" value={format} onChange={e=>setFormat(e.target.value)}>{danceFormats.map(value=><option key={value} value={value}>{t('format_'+value)}</option>)}</select></label>
      {options('level','classLevel','level_',classLevels,'OPEN')}
      {options('intensity','intensity','intensity_',intensities,'UNSPECIFIED')}
      {options('tempo','tempo','tempo_',tempos,'UNSPECIFIED')}
    </div>
    <p className="field-note">{t('intensityHint')}</p>
    <label className="checkbox"><input type="checkbox" name="partnerRequired" disabled={format==='SOLO'} defaultChecked={initial.partnerRequired==='true'}/>{t('partnerRequired')}</label>
    <p className="field-note">{t('partnerHint')}</p>
    <label>{t('prerequisites')}<textarea name="prerequisites" defaultValue={initial.prerequisites} rows={3} maxLength={1000}/><small>{t('prerequisitesHint')}</small></label>
    <fieldset className="tag-picker"><legend>{t('topics')}</legend>{tags.map(tag=><label className="checkbox" key={tag.id}><input type="checkbox" name="tagIds" value={tag.id} defaultChecked={selectedTags.includes(tag.id)}/>{t.has('tag_'+tag.id)?t('tag_'+tag.id):tag.name}</label>)}</fieldset>
  </>;
}
