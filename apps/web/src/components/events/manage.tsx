'use client';
import {useState} from 'react';
import {useLocale,useTranslations} from 'next-intl';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {api,useAction} from './client';
import '../../app/styles/events.css';
type Person={profileId:string;handle:string;name:string};
// Publish, cancel, return to draft and (owner only) delete — the life cycle of an event outside the big form.
export function EventActions({eventId,status,canDelete}:{eventId:string;status:string;canDelete:boolean}) {
  const x=useTranslations('EventsX'),locale=useLocale(),router=useRouter(),a=useAction();
  const [confirming,setConfirming]=useState(false);
  const change=(next:string,done:string)=>a.run(async()=>{await api('/api/events/'+eventId,'PATCH',{status:next});router.refresh();},done);
  return <section className="manage-panel" aria-labelledby="event-actions-title"><h2 id="event-actions-title">{x('lifecycle')}</h2>
    <p className="field-note">{x('lifecycle_'+status)}</p>
    <div className="panel-actions">
      {status!=='PUBLISHED'&&<button type="button" className="button" disabled={a.busy} onClick={()=>change('PUBLISHED',x('published'))}>{x(status==='CANCELLED'?'republish':'publish')}</button>}
      {status==='PUBLISHED'&&<button type="button" className="button secondary" disabled={a.busy} onClick={()=>change('CANCELLED',x('cancelledDone'))}>{x('cancelEvent')}</button>}
      {status==='PUBLISHED'&&<button type="button" className="button secondary" disabled={a.busy} onClick={()=>change('DRAFT',x('unpublished'))}>{x('unpublish')}</button>}
      {canDelete&&!confirming&&<button type="button" className="button secondary danger" disabled={a.busy} onClick={()=>setConfirming(true)}>{x('deleteEvent')}</button>}
    </div>
    {status==='PUBLISHED'&&<p className="field-note">{x('cancelHint')}</p>}
    {canDelete&&confirming&&<div className="confirm-box" role="group" aria-label={x('deleteEvent')}><p>{x('deleteConfirm')}</p><div className="panel-actions">
      <button type="button" className="button danger" disabled={a.busy} onClick={()=>a.run(async()=>{await api('/api/events/'+eventId,'DELETE');router.push('/'+locale+'/my-events');router.refresh();})}>{x('deleteYes')}</button>
      <button type="button" className="button secondary" disabled={a.busy} onClick={()=>setConfirming(false)}>{x('keep')}</button></div></div>}
    {a.feedback}
  </section>;
}
type Invite={id:string;email:string|null;handle:string|null;name:string|null;expiresAt:string};
// Co-organizers: the owner invites by @handle or email, revokes invitations and removes people;
// a co-organizer sees the team and may step down.
export function TeamPanel({eventId,owner,coOrganizers,invites,canTeam,selfProfileId}:{eventId:string;owner:Person[];coOrganizers:Person[];invites:Invite[];canTeam:boolean;selfProfileId:string}) {
  const x=useTranslations('EventsX'),locale=useLocale(),router=useRouter(),a=useAction();
  const [who,setWho]=useState('');
  // A fixed zone keeps the server and the browser on the same calendar day.
  const day=new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeZone:'UTC'});
  return <section className="manage-panel" aria-labelledby="team-title"><h2 id="team-title">{x('team')}</h2>
    <ul className="people-list">
      {owner.map(p=><li key={p.profileId}><Link href={'/'+locale+'/@'+p.handle}>{p.name}</Link><span className="badge">{x('role_OWNER')}</span></li>)}
      {coOrganizers.map(p=><li key={p.profileId}><Link href={'/'+locale+'/@'+p.handle}>{p.name}</Link><span className="badge">{x('role_CO_ORGANIZER')}</span>
        {(canTeam||p.profileId===selfProfileId)&&<button type="button" className="link-button" disabled={a.busy} aria-label={x(p.profileId===selfProfileId?'leaveTeam':'removeNamed',{name:p.name})}
          onClick={()=>a.run(async()=>{await api('/api/events/'+eventId+'/members/'+p.profileId,'DELETE');if(p.profileId===selfProfileId)router.push('/'+locale+'/my-events');router.refresh();},x('removed'))}>{x(p.profileId===selfProfileId?'leaveTeam':'remove',{name:p.name})}</button>}</li>)}
    </ul>
    {canTeam?<>
      <form className="inline-form" onSubmit={async e=>{e.preventDefault();const value=who.trim();if(!value)return;
        // "name@host" is an email; anything else is treated as a public @handle.
        const body=/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)?{email:value}:{handle:value};
        if(await a.run(async()=>{await api('/api/events/'+eventId+'/invites','POST',body);router.refresh();},x('inviteSent'))) setWho('');}}>
        <label>{x('inviteWho')}<input value={who} onChange={e=>setWho(e.target.value)} required maxLength={254} autoComplete="off" autoCapitalize="none" spellCheck={false}/><small>{x('inviteHint')}</small></label>
        <button className="button secondary" disabled={a.busy}>{x('invite')}</button></form>
      {invites.length>0&&<><h3>{x('pendingInvites')}</h3><ul className="people-list">{invites.map(i=><li key={i.id}><span>{i.handle?i.name+' (@'+i.handle+')':i.email}</span>
        <small>{x('inviteExpires',{date:day.format(new Date(i.expiresAt))})}</small>
        <button type="button" className="link-button" disabled={a.busy} aria-label={x('revokeNamed',{name:i.handle?'@'+i.handle:i.email||''})}
          onClick={()=>a.run(async()=>{await api('/api/events/'+eventId+'/invites/'+i.id,'DELETE');router.refresh();},x('revoked'))}>{x('revoke')}</button></li>)}</ul></>}
    </>:<p className="field-note">{x('teamOwnerOnly')}</p>}
    {a.feedback}
  </section>;
}
type Artist=Person&{type:string;stub:boolean};
// Artists: attach an existing profile by @handle, or create a profile without an owner on the spot.
export function ArtistPanel({eventId,artists}:{eventId:string;artists:Artist[]}) {
  const x=useTranslations('EventsX'),t=useTranslations('App'),locale=useLocale(),router=useRouter(),a=useAction();
  const [handle,setHandle]=useState(''),[name,setName]=useState(''),[type,setType]=useState('ARTIST');
  const add=(body:unknown,reset:()=>void)=>a.run(async()=>{await api('/api/events/'+eventId+'/artists','POST',body);router.refresh();},x('artistAdded')).then(ok=>{if(ok)reset();});
  return <section className="manage-panel" aria-labelledby="artists-title"><h2 id="artists-title">{x('artists')}</h2>
    {artists.length?<ul className="people-list">{artists.map(p=><li key={p.profileId}><Link href={'/'+locale+'/@'+p.handle}>{p.name}</Link><span className="badge">{t(p.type)}</span>{p.stub&&<span className="badge">{x('stubProfile')}</span>}
      <button type="button" className="link-button" disabled={a.busy} aria-label={x('removeNamed',{name:p.name})}
        onClick={()=>a.run(async()=>{await api('/api/events/'+eventId+'/artists/'+p.profileId,'DELETE');router.refresh();},x('removed'))}>{x('remove')}</button></li>)}</ul>:<p className="field-note">{x('noArtists')}</p>}
    <form className="inline-form" onSubmit={e=>{e.preventDefault();add({handle:handle.trim()},()=>setHandle(''));}}>
      <label>{x('artistHandle')}<input value={handle} onChange={e=>setHandle(e.target.value)} required minLength={3} maxLength={31} autoComplete="off" autoCapitalize="none" spellCheck={false}/><small>{x('artistHandleHint')}</small></label>
      <button className="button secondary" disabled={a.busy}>{x('attach')}</button></form>
    <form className="inline-form" onSubmit={e=>{e.preventDefault();add({name:name.trim(),type},()=>setName(''));}}>
      <label>{x('stubName')}<input value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={80}/><small>{x('stubHint')}</small></label>
      <label>{t('profileType')}<select value={type} onChange={e=>setType(e.target.value)}><option value="ARTIST">{t('ARTIST')}</option><option value="SCHOOL">{t('SCHOOL')}</option></select></label>
      <button className="button secondary" disabled={a.busy}>{x('createStub')}</button></form>
    {a.feedback}
  </section>;
}
type ManagedDate={id:string;startsAt:string;startsLocal:string;endsLocal:string;cancelled:boolean;past:boolean;original:string|null};
// Single dates of a series: cancel one, bring it back, or move it to another time without touching the others.
export function OccurrencePanel({eventId,timezone,occurrences}:{eventId:string;timezone:string;occurrences:ManagedDate[]}) {
  const x=useTranslations('EventsX'),t=useTranslations('App'),locale=useLocale(),router=useRouter(),a=useAction();
  const [moving,setMoving]=useState<string|null>(null);
  const label=new Intl.DateTimeFormat(locale,{dateStyle:'full',timeStyle:'short',timeZone:timezone});
  const target=occurrences.find(o=>o.id===moving&&!o.past&&!o.cancelled);
  return <section className="manage-panel" aria-labelledby="dates-title"><h2 id="dates-title">{x('singleDates')}</h2><p className="field-note">{x('singleDatesHint')}</p>
    <ol className="date-list">{occurrences.map(o=>{const text=label.format(new Date(o.startsAt));return <li key={o.id}>
      <time dateTime={o.startsAt}>{o.cancelled?<s>{text}</s>:text}</time>{o.cancelled&&<span className="badge">{t('CANCELLED')}</span>}
      {o.original&&<span className="badge" title={x('movedFrom',{date:label.format(new Date(o.original))})}>{x('movedBadge')}</span>}
      {!o.past&&!o.cancelled&&<button type="button" className="link-button" disabled={a.busy} aria-expanded={moving===o.id} aria-controls="move-date-form" aria-label={x('moveDateNamed',{date:text})}
        onClick={()=>setMoving(moving===o.id?null:o.id)}>{x('moveDate')}</button>}
      {!o.past&&<button type="button" className="link-button" disabled={a.busy} aria-label={x(o.cancelled?'restoreDateNamed':'cancelDateNamed',{date:text})}
        onClick={()=>a.run(async()=>{await api('/api/events/'+eventId+'/occurrences/'+o.id,'PATCH',{cancelled:!o.cancelled});router.refresh();},x(o.cancelled?'dateRestored':'dateCancelled'))}>{x(o.cancelled?'restoreDate':'cancelDate')}</button>}</li>;})}</ol>
    <div id="move-date-form">{target&&<form key={target.id} className="inline-form" aria-label={x('moveDateNamed',{date:label.format(new Date(target.startsAt))})} onSubmit={async e=>{e.preventDefault();
        const data=new FormData(e.currentTarget),body={startsLocal:String(data.get('startsLocal')),endsLocal:String(data.get('endsLocal'))};
        if(await a.run(async()=>{await api('/api/events/'+eventId+'/occurrences/'+target.id,'PATCH',body);router.refresh();},x('dateMoved'))) setMoving(null);}}>
      <p className="field-note">{x('moveDateHint',{date:label.format(new Date(target.startsAt)),zone:timezone})}{target.original&&<> {x('movedFrom',{date:label.format(new Date(target.original))})}</>}</p>
      <label>{x('moveStarts')}<input name="startsLocal" type="datetime-local" required defaultValue={target.startsLocal} autoFocus/></label>
      <label>{x('moveEnds')}<input name="endsLocal" type="datetime-local" required defaultValue={target.endsLocal}/></label>
      <button className="button secondary" disabled={a.busy}>{x('moveSave')}</button>
      <button type="button" className="button secondary" disabled={a.busy} onClick={()=>setMoving(null)}>{x('moveCancel')}</button>
    </form>}</div>
    {a.feedback}
  </section>;
}
// Accept or decline a co-organizer invitation.
export function InviteAnswer({token,slug}:{token:string;slug:string}) {
  const x=useTranslations('EventsX'),locale=useLocale(),router=useRouter(),a=useAction();
  const answer=(action:'accept'|'decline')=>a.run(async()=>{await api('/api/invites/'+token,'POST',{action});
    router.push('/'+locale+(action==='accept'?'/events/'+slug+'/edit':'/my-events'));router.refresh();});
  return <div><div className="panel-actions"><button type="button" className="button" disabled={a.busy} onClick={()=>answer('accept')}>{x('acceptInvite')}</button>
    <button type="button" className="button secondary" disabled={a.busy} onClick={()=>answer('decline')}>{x('declineInvite')}</button></div>{a.feedback}</div>;
}
