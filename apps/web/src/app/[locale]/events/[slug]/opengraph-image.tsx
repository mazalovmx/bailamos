import {ImageResponse} from 'next/og';
import {isPublic} from '../../../../lib/events/access';
import {loadEvent,pickOccurrence} from '../../../../lib/events/page-data';
export const alt='Dance Community';
export const size={width:1200,height:630};
export const contentType='image/png';
// Preview image for links to an event: title, date in the event's zone, city and the brand.
// Drafts and hidden events get the neutral brand card, so nothing about them leaks through the image URL.
export default async function Image({params}:{params:Promise<{locale:string;slug:string}>|{locale:string;slug:string}}) {
  const {locale,slug}=await params,found=await loadEvent(slug),event=found&&isPublic(found)?found:null;
  const startsAt=event?(pickOccurrence(event)?.startsAt||event.startsAt):null;
  const safeLocale=['en','es','ru'].includes(locale)?locale:'en';
  const date=event&&startsAt?new Intl.DateTimeFormat(safeLocale,{dateStyle:'full',timeStyle:'short',timeZone:event.timezone}).format(startsAt):'';
  const place=event?[event.venue&&!event.venue.hiddenAt?event.venue.name:'',event.city.name].filter(Boolean).join(', '):'';
  const title=event?event.title:'Dance Community';
  return new ImageResponse(
    <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',justifyContent:'space-between',background:'#f6f4ee',color:'#253b2f',padding:'64px 72px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{display:'flex',fontSize:34,fontWeight:700,letterSpacing:-1}}>dance community</div>
        {event&&<div style={{display:'flex',fontSize:26,background:event.status==='CANCELLED'?'#fce8e1':'#dafa7c',color:event.status==='CANCELLED'?'#7c2815':'#253b2f',padding:'10px 24px',borderRadius:40}}>
          {event.styles.map(s=>s.style.name).slice(0,2).join(' · ')||'Swing'}</div>}
      </div>
      <div style={{display:'flex',flexDirection:'column'}}>
        <div style={{display:'flex',fontSize:title.length>60?56:title.length>32?68:84,fontWeight:700,lineHeight:1.08,letterSpacing:-2,textDecoration:event?.status==='CANCELLED'?'line-through':'none'}}>{title.slice(0,110)}</div>
        {date&&<div style={{display:'flex',fontSize:36,marginTop:32}}>{date}</div>}
        {event&&<div style={{display:'flex',fontSize:28,marginTop:10,color:'#516149'}}>{event.timezone}</div>}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',borderTop:'3px solid #253b2f',paddingTop:26}}>
        <div style={{display:'flex',fontSize:36,fontWeight:700}}>{place}</div>
        <div style={{display:'flex',fontSize:60,color:'#496149'}}>♪</div>
      </div>
    </div>,size);
}
