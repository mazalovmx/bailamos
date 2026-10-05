'use client';
import {useSearchParams} from 'next/navigation';
import {useTranslations} from 'next-intl';
import {queryParams,type SearchQuery} from '../lib/search-query';
export function DiscoveryNav({locale,query}:{locale:string;query:SearchQuery}){
  const t=useTranslations('App'),x=useTranslations('EventsX'),live=useSearchParams();
  const params=queryParams(query);
  for(const key of new Set(live.keys())){params.delete(key);for(const value of live.getAll(key))params.append(key,value);}
  params.delete('page');params.delete('radius');
  return <nav className="quick-links" aria-label={x('discoveryViews')}>{[['events',t('events')],['map',x('mapView')],['calendar',x('calendarView')],['classes',t('regularClasses')]].map(([path,label])=><a key={path} href={'/'+locale+'/'+path+'?'+params}>{label}</a>)}</nav>;
}
export function DiscoveryDateFields(){
  const query=useSearchParams();
  return <>{['from','to'].map(key=>query.get(key)?<input key={key} type="hidden" name={key} value={query.get(key)!}/>:null)}</>;
}
