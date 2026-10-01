'use client';
import {useEffect,useRef,useState,useId} from 'react';
import {useTranslations} from 'next-intl';
type Content={title:string;date:string;place:string;text:string};
function lines(ctx:CanvasRenderingContext2D,text:string,width:number){
  const result:string[]=[];let line='';
  for(const word of text.replace(/\s+/g,' ').trim().split(' ')){
    if(ctx.measureText(line+(line?' ':'')+word).width<=width){line+=(line?' ':'')+word;continue;}
    if(line)result.push(line);line='';
    for(const char of word){if(ctx.measureText(line+char).width>width){result.push(line);line='';}line+=char;}
  }
  if(line)result.push(line);return result;
}
function textBox(ctx:CanvasRenderingContext2D,text:string,y:number,height:number,size:number,bold=false){
  let rows:string[]=[];
  do{ctx.font=`${bold?'700':'400'} ${size}px Arial`;rows=lines(ctx,text,920);if(rows.length*size*1.2<=height)break;size-=2;}while(size>12);
  rows.forEach((line,i)=>ctx.fillText(line,80,y+i*size*1.2));
}
export function AnnouncementStudio({initial,urlPath}:{initial?:Partial<Content>;urlPath?:string}){
  const t=useTranslations('App');
  const [content,setContent]=useState<Content>({title:initial?.title??t('sampleTitle'),date:initial?.date??'',place:initial?.place??'',text:initial?.text??t('sampleText')});
  const [height,setHeight]=useState(1350),[photo,setPhoto]=useState<ImageBitmap|null>(null),[file,setFile]=useState<File|null>(null),[message,setMessage]=useState(''),[url,setUrl]=useState('');
  const canvas=useRef<HTMLCanvasElement>(null),upload=useRef(0);
  const fieldsId=useId(),previewId=useId();
  const [crop,setCrop]=useState(50);
  useEffect(()=>{setUrl(urlPath?new URL(urlPath,window.location.origin).href:'');},[urlPath]);
  useEffect(()=>()=>photo?.close(),[photo]);
  useEffect(()=>()=>{upload.current++;},[]);
  const caption=[content.title,content.date,content.place,content.text,url].filter(Boolean).join('\n\n');
  useEffect(()=>{
    let active=true;setFile(null);
    const surface=canvas.current,ctx=surface?.getContext('2d');if(!surface||!ctx)return;
    surface.width=1080;surface.height=height;
    ctx.fillStyle='#f6f4ee';ctx.fillRect(0,0,1080,height);ctx.textBaseline='top';
    const top=photo?Math.round(height*.36):Math.round(height*.2);
    if(photo){const scale=Math.max(1080/photo.width,top/photo.height);ctx.drawImage(photo,(1080-photo.width*scale)/2,(top-photo.height*scale)*crop/100,photo.width*scale,photo.height*scale);}
    else{ctx.fillStyle='#dafa7c';ctx.fillRect(0,0,1080,top);ctx.strokeStyle='#6d8054';ctx.lineWidth=3;for(let i=0;i<4;i++){ctx.beginPath();ctx.ellipse(830,top/2,160+i*45,60+i*30,-.4,0,Math.PI*2);ctx.stroke();}ctx.fillStyle='#253b2f';ctx.font='700 38px Arial';ctx.fillText('LET’S SWING',80,top/2-19);}
    // The photo is clipped by repainting everything below its allocated area.
    ctx.fillStyle='#f6f4ee';ctx.fillRect(0,top,1080,height-top);
    const space=height-top-200;
    const blocks=[{text:content.title,weight:3,size:76,bold:true},{text:content.date,weight:1.4,size:36,bold:true},{text:content.place,weight:1.2,size:34,bold:false},{text:content.text,weight:2.4,size:40,bold:false}].filter(block=>block.text.trim());
    const totalWeight=blocks.reduce((sum,block)=>sum+block.weight,0);
    let y=top+50;
    ctx.fillStyle='#253b2f';
    for(const block of blocks){const allocated=space*block.weight/totalWeight;textBox(ctx,block.text,y,allocated-20,block.size,block.bold);y+=allocated;}
    ctx.fillStyle='#253b2f';ctx.fillRect(0,height-100,1080,100);ctx.fillStyle='#dafa7c';ctx.font='700 26px Arial';ctx.fillText('dance community',80,height-64);
    surface.toBlob(blob=>{if(active&&blob)setFile(new File([blob],'dance-announcement-'+height+'.png',{type:'image/png'}));else if(active)setMessage(t('imageError'));},'image/png');
    return()=>{active=false;};
  },[content,height,photo,crop,t]);
  async function loadPhoto(event:React.ChangeEvent<HTMLInputElement>){
    const picked=event.target.files?.[0],version=++upload.current;event.target.value='';if(!picked)return;
    if(!['image/jpeg','image/png','image/webp'].includes(picked.type)||picked.size>10*1024*1024){setMessage(t('photoError'));return;}
    try{const bitmap=await createImageBitmap(picked);if(version!==upload.current){bitmap.close();return;}setFile(null);setCrop(50);setPhoto(bitmap);setMessage('');}catch{setMessage(t('imageError'));}
  }
  function download(){if(!file)return;const href=URL.createObjectURL(file),link=document.createElement('a');link.href=href;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(href),10000);}
  async function share(){if(!file)return;try{if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});}else setMessage(t('shareFallback'));}catch(error){if(!(error instanceof Error&&error.name==='AbortError'))setMessage(t('shareFallback'));}}
  return <><nav className="studio-jumps" aria-label={t('studioNavigation')}><a href={'#'+fieldsId}>{t('editAnnouncement')}</a><a href={'#'+previewId}>{t('previewAndSave')} ↓</a></nav><div className="studio"><div className="studio-fields" id={fieldsId} tabIndex={-1}>
    {(['title','date','place','text'] as const).map(key=><label key={key}>{t({title:'posterTitle',date:'posterDate',place:'posterPlace',text:'posterText'}[key])}<textarea rows={key==='text'?3:2} maxLength={key==='text'?260:key==='date'?140:120} value={content[key]} onChange={e=>{setFile(null);setContent({...content,[key]:e.target.value});}}/></label>)}
    <label>{t('posterPhoto')}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={loadPhoto}/><small>{t('photoHelp')}</small></label>
    {photo&&<button type="button" className="button secondary" onClick={()=>{upload.current++;setFile(null);setPhoto(null);}}>{t('removePhoto')}</button>}
    {photo&&<label>{t('photoPosition')}<input type="range" min="0" max="100" value={crop} onChange={e=>{setFile(null);setCrop(Number(e.target.value));}}/><small>{t('photoPositionHelp')}</small></label>}
    <fieldset className="size-picker"><legend>{t('posterSize')}</legend>{[[1350,'sizePost'],[1920,'sizeStory'],[1080,'sizeSquare']].map(([value,key])=><label key={value}><input type="radio" name="poster-size" value={value} checked={height===value} onChange={()=>{setFile(null);setHeight(Number(value));}}/>{t(String(key))}</label>)}</fieldset>
    <label>{t('copyManual')}<textarea readOnly rows={5} value={caption}/></label><button className="button secondary" onClick={async()=>{try{await navigator.clipboard.writeText(caption);setMessage(t('copied'));}catch{setMessage(t('copyManual'));}}}>{t('copyCaption')}</button>
  </div><div className="studio-preview" id={previewId} tabIndex={-1}><h3>{t('preview')}</h3><canvas ref={canvas} aria-label={t('preview')+' — '+content.title} role="img"/><div className="studio-actions"><button className="button" disabled={!file} onClick={download}>{t('savePng')}</button><button className="button secondary" disabled={!file} onClick={share}>{t('shareImage')}</button></div><p className="field-note">{t('shareHelp')}</p><p role="status" aria-live="polite">{message}</p><a className="home-secondary" href={'#'+fieldsId}>↑ {t('editAnnouncement')}</a></div></div></>;
}
