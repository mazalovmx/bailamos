import {db,lockEvent,changeEventStatus,queueEventNotice,eventShortCode} from '@dance/db';
import {apiError, ApiError, jsonBody, viewer} from '../../../../lib/api';
import {prepareEvent, syncOccurrences} from '../../../../lib/event-input';
import {eventAbility} from '../../../../lib/permissions';
import {managesSchool} from '../../../../lib/schools/access';
import {managedEvent, isPublic} from '../../../../lib/events/access';
import {statusInput} from '../../../../lib/events/schema';
import {tryEventDelivery} from '../../../../lib/events/outbox';
type Context={params:Promise<{id:string}>};
// Public facts of one event. Drafts and hidden events exist only for their organizers.
export async function GET(request: Request, {params}: Context) {
  try {
    const {id}=await params,user=await viewer(request);
    const event=await db.event.findUnique({where:{id},include:{members:{select:{profileId:true,role:true}},city:{select:{id:true,name:true,countryCode:true}},
      venue:{select:{id:true,name:true,address:true,lat:true,lng:true,hiddenAt:true}},styles:{select:{styleId:true}},tags:{select:{tagId:true}},
      occurrences:{orderBy:{startsAt:'asc'},select:{id:true,startsAt:true,endsAt:true,cancelled:true,originalStartsAt:true}}}});
    if (!event || (!isPublic(event) && !eventAbility(user?.profile?.id,event.members,managesSchool(user,event.schoolProfileId)).can('manage','Event'))) throw new ApiError('NOT_FOUND',404);
    const venue=event.venue&&!event.venue.hiddenAt?{id:event.venue.id,name:event.venue.name,address:event.venue.address,lat:event.venue.lat,lng:event.venue.lng}:null;
    return Response.json({id:event.id,version:event.version,slug:event.slug,shortCode:event.shortCode,title:event.title,description:event.description,status:event.status,
      startsAt:event.startsAt,endsAt:event.endsAt,timezone:event.timezone,rrule:event.rrule,city:event.city,venue,priceText:event.priceText,
      kind:event.kind,format:event.format,level:event.level,intensity:event.intensity,tempo:event.tempo,prerequisites:event.prerequisites,
      partnerRequired:event.partnerRequired,attendeeVisibility:event.attendeeVisibility,styleIds:event.styles.map(s=>s.styleId),
      tagIds:event.tags.map(t=>t.tagId),occurrences:event.occurrences});
  } catch(error) {return apiError(error);}
}
// Full edit, or — when the body holds nothing but {status} — a quick publish / cancel / back to draft.
export async function PATCH(request: Request, {params}: Context) {
  try {
    const {id}=await params;
    const {event,user}=await managedEvent(request,id);
    const body=await jsonBody(request);
    let updated;
    if (body&&typeof body==='object'&&Object.keys(body).every(key=>['status','version'].includes(key))&&'status' in body) {
      const quick=statusInput.parse(body);
      updated=await db.$transaction(tx=>changeEventStatus(tx,id,quick.status,user.id,quick.version));
    } else {
      const version=Number(body?.version);
      if(!Number.isSafeInteger(version)||version<1)throw new ApiError('EVENT_CONFLICT',409);
      const {fields,occurrences,styleId,tagIds,exactPlace}=await prepareEvent(body);
      if (!exactPlace) throw new ApiError('PLACE_REQUIRED',400);
      // A new map photo must be the editor's own upload; the one already on the event may stay.
      if (fields.mapImageKey && fields.mapImageKey!==event.mapImageKey && !fields.mapImageKey.startsWith('img/'+(user.profile?.id||'')+'/')) throw new ApiError('INVALID_MAP_IMAGE',400);
      updated=await db.$transaction(async tx=>{
        const before=await lockEvent(tx,id,version);
        const saved=await tx.event.update({where:{id},data:{...fields,version:{increment:1},
          ...(fields.status==='PUBLISHED'&&!before.shortCode?{shortCode:eventShortCode()}:{}),
          styles:{deleteMany:{},create:{styleId}},
          tags:{deleteMany:{},create:tagIds.map(tagId=>({tagId}))}
        }});
        await syncOccurrences(tx,id,occurrences,new Date(),before.startsAt.getTime()!==fields.startsAt.getTime());
        if(before.status==='PUBLISHED'){
          const cancelled=fields.status==='CANCELLED'||fields.status==='DRAFT';
          const changed=['startsAt','endsAt','timezone','rrule','venueId','address','lat','lng'].some(key=>String(before[key as keyof typeof before])!==String(fields[key as keyof typeof fields]));
          if(cancelled||changed)await queueEventNotice(tx,saved,{type:cancelled?'EVENT_CANCELLED':'EVENT_MOVED',key:`event:${id}:${saved.version}`,exceptUserId:user.id,
            previous:before.startsAt,previousPlace:before.address||undefined,link:fields.status!=='DRAFT'});
        }
        return saved;
      });
    }
    await tryEventDelivery();
    return Response.json({id,slug:event.slug,status:updated.status,shortCode:updated.shortCode,version:updated.version});
  } catch(error) {return apiError(error);}
}
// Removes the event for good, with its dates, team, invitations, RSVPs and media rows. Owner only.
export async function DELETE(request: Request, {params}: Context) {
  try {
    const {id}=await params;
    const {user}=await managedEvent(request,id,'delete');
    await db.$transaction(async tx=>{
      const current=await lockEvent(tx,id);
      if(current.status==='PUBLISHED')await queueEventNotice(tx,current,{type:'EVENT_CANCELLED',key:`event:${id}:delete`,exceptUserId:user.id,link:false});
      await tx.event.delete({where:{id}});
    });
    await tryEventDelivery();
    return Response.json({deleted:true});
  } catch(error) {return apiError(error);}
}
