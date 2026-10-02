'use client';
import {useEffect,useRef} from 'react';
import {useT} from './i18n';
import 'driver.js/dist/driver.css';
export function SchoolGuide({userId,global}:{userId:string;global:boolean}){
  const {t}=useT(), tour=useRef<import('driver.js').Driver|null>(null),key=`dance-guide:${userId}:school-admin`;
  useEffect(()=>{
    let cancelled=false;
    try{if(localStorage.getItem(key))return;}catch{/* Optional persistence. */}
    void import('driver.js').then(({driver})=>{
      if(cancelled)return;
      const instance=driver({showProgress:true,progressText:'{{current}} of {{total}}',nextBtnText:t('guide.next'),prevBtnText:t('guide.previous'),doneBtnText:t('guide.done'),
        allowKeyboardControl:true,allowClose:true,smoothScroll:true,skipMissingElement:true,popoverClass:'dance-guide-popover',
        onDestroyed:()=>{tour.current=null;try{localStorage.setItem(key,'done');}catch{/* Optional persistence. */}}});
      tour.current=instance;
      const steps=[['intro','school.guideIntroTitle','school.guideIntroText'],['select','school.guideSelectTitle','school.guideSelectText'],...(global?[['admins','school.guideAdminsTitle','school.guideAdminsText']]:[]),['resources','school.guideResourcesTitle','school.guideResourcesText']];
      instance.setSteps(steps.map(([id,title,description])=>({element:`[data-guide="school-admin-${id}"]`,popover:{title:t(title),description:t(description)}})));
      instance.drive();
    });
    return()=>{cancelled=true;tour.current?.destroy();tour.current=null;};
  },[key,global,t]);
  return <button type="button" className="admin-guide-replay" onClick={async()=>{
    const {driver}=await import('driver.js');
    const instance=tour.current||driver({showProgress:true,progressText:'{{current}} of {{total}}',nextBtnText:t('guide.next'),prevBtnText:t('guide.previous'),doneBtnText:t('guide.done'),allowKeyboardControl:true,allowClose:true,smoothScroll:true,skipMissingElement:true,popoverClass:'dance-guide-popover'});
    tour.current=instance;
    const steps=[['intro','school.guideIntroTitle','school.guideIntroText'],['select','school.guideSelectTitle','school.guideSelectText'],...(global?[['admins','school.guideAdminsTitle','school.guideAdminsText']]:[]),['resources','school.guideResourcesTitle','school.guideResourcesText']];
    instance.setSteps(steps.map(([id,title,description])=>({element:`[data-guide="school-admin-${id}"]`,popover:{title:t(title),description:t(description)}})));instance.drive();
  }}>{t('school.guideReplay')}</button>;
}
