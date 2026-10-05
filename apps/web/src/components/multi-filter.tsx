'use client';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
export function MultiFilter({name,label,all,items,initial,selection,onChange}:{name:string;label:string;all:string;items:{id:string;name:string}[];initial:string[];selection?:string[];onChange?:(value:string[])=>void}){
  const [stored,setStored]=useState(initial),selected=selection??stored;
  const setSelected=(next:string[])=>{setStored(next);onChange?.(next);};
  const [search,setSearch]=useState('');
  const t=useTranslations('App');
  const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
  const visible=(item:{name:string})=>normalize(item.name).includes(normalize(search.trim()));
  function toggle(id:string){setSelected(selected.includes(id)?selected.filter(v=>v!==id):[...selected,id]);}
  return <div className="multi-filter"><details><summary><span>{label}</span><small>{selected.length?selected.length+' · '+items.filter(i=>selected.includes(i.id)).map(i=>i.name).join(', '):all}</small></summary>{items.length>10&&<label className="option-search">{t('searchOptions',{name:label})}<input type="search" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.preventDefault();}}/></label>}<div className="group-actions"><button type="button" onClick={()=>setSelected([...new Set([...selected,...items.filter(visible).map(i=>i.id)])])}>{t(search?'selectVisible':'selectAll')}</button><button type="button" disabled={!selected.length} onClick={()=>setSelected([])}>{t('clearGroup')}</button></div><fieldset><legend className="sr-only">{label}</legend>{items.map(item=><label key={item.id} hidden={!visible(item)}><input type="checkbox" name={name} value={item.id} checked={selected.includes(item.id)} onChange={()=>toggle(item.id)}/>{item.name}</label>)}{!items.some(visible)&&<p role="status">{t('noOptions')}</p>}</fieldset></details>{selected.length>0&&<div className="filter-chips">{items.filter(i=>selected.includes(i.id)).map(i=><button key={i.id} type="button" onClick={()=>toggle(i.id)} aria-label={t('removeFilter',{name:i.name})}>{i.name} ×</button>)}</div>}</div>;
}
