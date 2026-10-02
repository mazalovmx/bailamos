import {db} from '@dance/db';
import {apiError, ApiError, jsonBody, viewer} from '../../../../lib/api';
import {prepareEvent, syncOccurrences} from '../../../../lib/event-input';
import {eventAbility} from '../../../../lib/permissions';
import {managesSchool} from '../../../../lib/schools/access';
import {managedEvent, isPublic} from '../../../../lib/events/access';
import {statusInput} from '../../../../lib/events/schema';
import {ensureShortCode} from '../../../../lib/events/short-code';
import {announceCancellation} from '../../../../lib/events/cancel';
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
    return Response.json({id:event.id,slug:event.slug,shortCode:event.shortCode,title:event.title,description:event.description,status:event.status,
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
    let status:string;
    if (body&&typeof body==='object'&&Object.keys(body).length===1&&'status' in body) {
      const quick=statusInput.parse(body);
      status=quick.status;
      await db.event.update({where:{id},data:quick});
    } else {
      const {fields,occurrences,styleId,tagIds,exactPlace}=await prepareEvent(body);
      if (!exactPlace) throw new ApiError('PLACE_REQUIRED',400);
      // A new map photo must be the editor's own upload; the one already on the event may stay.
      if (fields.mapImageKey && fields.mapImageKey!==event.mapImageKey && !fields.mapImageKey.startsWith('img/'+(user.profile?.id||'')+'/')) throw new ApiError('INVALID_MAP_IMAGE',400);
      status=fields.status;
      await db.$transaction(async tx=>{
        await tx.event.update({where:{id},data:{...fields,
          styles:{deleteMany:{},create:{styleId}},
          tags:{deleteMany:{},create:tagIds.map(tagId=>({tagId}))}
        }});
        await syncOccurrences(tx,id,occurrences);
      });
    }
    const shortCode=status==='PUBLISHED'?await ensureShortCode(id):event.shortCode;
    // Attendees are told once: only the change from published to cancelled announces anything.
    if (status==='CANCELLED'&&event.status==='PUBLISHED') await announceCancellation(id,{exceptUserId:user.id});
    return Response.json({id,slug:event.slug,status,shortCode});
  } catch(error) {return apiError(error);}
}
// Removes the event for good, with its dates, team, invitations, RSVPs and media rows. Owner only.
export async function DELETE(request: Request, {params}: Context) {
  try {
    const {id}=await params;
    const {event,user}=await managedEvent(request,id,'delete');
    // People who planned to come to a live event learn that it is gone; the notice carries no link.
    if (event.status==='PUBLISHED'&&await db.eventOccurrence.count({where:{eventId:id,cancelled:false,startsAt:{gte:new Date()}}}))
      await announceCancellation(id,{exceptUserId:user.id,link:false});
    await db.event.delete({where:{id}});
    return Response.json({deleted:true});
  } catch(error) {return apiError(error);}
}
