import {getTranslations} from 'next-intl/server';
import {eventKinds,danceFormats,classLevels,intensities,tempos} from '../lib/swing';
import {MultiFilter} from './multi-filter';
import {type SearchQuery,values,first} from '../lib/search-query';
export async function EventFilters({locale,query,cities,styles,tags}:{locale:string;query:SearchQuery;cities:{id:string;name:string}[];styles:{id:string;name:string}[];tags:{id:string;name:string}[]}) {
  const t=await getTranslations('App');
  function select(name:string,label:string,all:string,items:{id:string;name:string}[]) {
    return <MultiFilter key={name+values(query[name]).join(',')} name={name} label={t(label)} all={t(all)} items={items} initial={values(query[name]).filter(id=>items.some(i=>i.id===id))}/>;
  }
  const opts=(items:readonly string[],prefix:string)=>items.filter(id=>id!=='UNSPECIFIED').map(id=>({id,name:t(prefix+id)}));
  const advanced=['format','level','intensity','tempo','tag','noPartner','recurring'].some(key=>query[key]);
  return <>
    <div className="quick-links"><a href={'/'+locale+'/events?style=lindy-hop'}>Lindy Hop</a><a href={'/'+locale+'/events?style=solo-jazz&format=SOLO'}>Solo Jazz</a><a href={'/'+locale+'/events?kind=CLASS&recurring=1'}>{t('regularClasses')}</a><a href={'/'+locale+'/events?kind=WORKSHOP'}>{t('kind_WORKSHOP')}</a></div>
    <form className="search-panel" action={'/'+locale+'/events'}>
      <p className="filter-help">{t('filterHelp')}</p>
      <div className="filters">
        {select('city','city','allCities',cities)}{select('style','style','allStyles',styles)}{select('kind','kind','allKinds',opts(eventKinds,'kind_'))}
        <label>{t('search')}<input name="q" maxLength={100} defaultValue={first(query.q)} placeholder={t('searchPlaceholder')}/></label>
      </div>
      <details className="advanced-filters" open={advanced}><summary>{t('advancedFilters')}</summary><div className="filters">
        {select('format','format','allFormats',opts(danceFormats,'format_'))}
        {select('level','classLevel','allLevels',opts(classLevels,'level_'))}
        {select('intensity','intensity','allIntensities',opts(intensities,'intensity_'))}
        {select('tempo','tempo','allTempos',opts(tempos,'tempo_'))}
        {select('tag','topics','allTopics',tags.map(tag=>({id:tag.id,name:t.has('tag_'+tag.id)?t('tag_'+tag.id):tag.name})))}
        <label className="checkbox"><input type="checkbox" name="noPartner" value="1" defaultChecked={values(query.noPartner).includes('1')}/>{t('noPartnerNeeded')}</label>
        <label className="checkbox"><input type="checkbox" name="recurring" value="1" defaultChecked={values(query.recurring).includes('1')}/>{t('regularClasses')}</label>
      </div></details>
      <div className="filter-actions"><button className="button">{t('filter')}</button><a href={'/'+locale+'/events'}>{t('clear')}</a></div>
    </form>
  </>;
}
